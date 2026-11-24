//! Statements sent in batches, each run as one transaction: natively beside the
//! core, in an OPFS worker on the web, and in the desktop shell.
#![allow(
    clippy::missing_errors_doc,
    reason = "every error is SQLite's or the wire format's, as text"
)]

use serde::{Deserialize, Serialize};

#[cfg(feature = "engine")]
pub use rusqlite;
#[cfg(feature = "engine")]
use rusqlite::{
    Connection, params_from_iter,
    types::{Value as SqliteValue, ValueRef},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Value {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl From<&str> for Value {
    fn from(text: &str) -> Self {
        Self::Text(text.to_owned())
    }
}

impl From<String> for Value {
    fn from(text: String) -> Self {
        Self::Text(text)
    }
}

impl From<i64> for Value {
    fn from(number: i64) -> Self {
        Self::Integer(number)
    }
}

impl From<Vec<u8>> for Value {
    fn from(bytes: Vec<u8>) -> Self {
        Self::Blob(bytes)
    }
}

impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(value: Option<T>) -> Self {
        value.map_or(Self::Null, Into::into)
    }
}

#[macro_export]
macro_rules! statement {
    ($sql:expr $(, $param:expr)* $(,)?) => {
        $crate::Statement {
            sql: ($sql).to_owned(),
            params: vec![$($crate::Value::from($param)),*],
        }
    };
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Statement {
    pub sql: String,
    pub params: Vec<Value>,
}

pub type Rows = Vec<Vec<Value>>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Request {
    pub id: u32,
    pub database: String,
    pub statements: Vec<Statement>,
    /// Deletes the database instead of running anything.
    pub remove: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Response {
    pub id: u32,
    pub result: Result<Vec<Rows>, String>,
}

pub fn decode<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Result<T, String> {
    rmp_serde::from_slice(bytes).map_err(|error| error.to_string())
}

#[must_use]
pub fn encode<T: Serialize>(message: &T) -> Vec<u8> {
    rmp_serde::to_vec(message).unwrap_or_default()
}

// The name becomes a file in the databases' directory, and must not lead out of it.
fn is_database_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', '\0'])
}

#[cfg(feature = "engine")]
impl From<Value> for SqliteValue {
    fn from(value: Value) -> Self {
        match value {
            Value::Null => Self::Null,
            Value::Integer(number) => Self::Integer(number),
            Value::Real(number) => Self::Real(number),
            Value::Text(text) => Self::Text(text),
            Value::Blob(bytes) => Self::Blob(bytes),
        }
    }
}

#[cfg(feature = "engine")]
impl From<ValueRef<'_>> for Value {
    fn from(value: ValueRef<'_>) -> Self {
        match value {
            ValueRef::Null => Self::Null,
            ValueRef::Integer(number) => Self::Integer(number),
            ValueRef::Real(number) => Self::Real(number),
            ValueRef::Text(text) => Self::Text(String::from_utf8_lossy(text).into_owned()),
            ValueRef::Blob(bytes) => Self::Blob(bytes.to_vec()),
        }
    }
}

/// Pragmas a batch cannot set, as they do not hold inside a transaction. OPFS
/// has no write-ahead log.
#[cfg(feature = "engine")]
pub fn prepare(connection: &Connection, write_ahead_log: bool) -> rusqlite::Result<()> {
    if write_ahead_log {
        connection.pragma_update(None, "journal_mode", "WAL")?;
    }
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "foreign_keys", true)?;
    Ok(())
}

/// Rolls the whole batch back when a statement fails.
#[cfg(feature = "engine")]
pub fn run_batch(
    connection: &mut Connection,
    statements: &[Statement],
) -> rusqlite::Result<Vec<Rows>> {
    let transaction = connection.transaction()?;
    let mut answers = Vec::with_capacity(statements.len());
    for statement in statements {
        let mut prepared = transaction.prepare_cached(&statement.sql)?;
        let params = statement.params.iter().cloned().map(SqliteValue::from);
        let columns = prepared.column_count();
        let mut found = prepared.query(params_from_iter(params))?;
        let mut rows = Rows::new();
        while let Some(row) = found.next()? {
            rows.push(
                (0..columns)
                    .map(|column| row.get_ref(column).map(Value::from))
                    .collect::<rusqlite::Result<_>>()?,
            );
        }
        answers.push(rows);
    }
    transaction.commit()?;
    Ok(answers)
}

#[cfg(feature = "engine")]
pub trait Databases {
    /// Opens `name` the first time.
    fn connection(&mut self, name: &str) -> Result<&mut Connection, String>;
    fn remove(&mut self, name: &str) -> Result<(), String>;
}

#[cfg(feature = "engine")]
pub fn answer(bytes: &[u8], databases: &mut impl Databases) -> Vec<u8> {
    let request: Request = match decode(bytes) {
        Ok(request) => request,
        Err(error) => {
            return encode(&Response {
                id: 0,
                result: Err(error),
            });
        }
    };
    let result = if !is_database_name(&request.database) {
        Err(format!("{:?} is not a database name", request.database))
    } else if request.remove {
        databases.remove(&request.database).map(|()| Vec::new())
    } else {
        databases
            .connection(&request.database)
            .and_then(|connection| {
                run_batch(connection, &request.statements).map_err(|error| error.to_string())
            })
    };
    encode(&Response {
        id: request.id,
        result,
    })
}

#[cfg(all(test, feature = "engine"))]
mod tests {
    use rusqlite::Connection;

    use super::{
        Databases, Request, Response, Value, answer, decode, encode, is_database_name, run_batch,
    };

    struct One(Connection);

    impl Databases for One {
        fn connection(&mut self, _: &str) -> Result<&mut Connection, String> {
            Ok(&mut self.0)
        }

        fn remove(&mut self, _: &str) -> Result<(), String> {
            Ok(())
        }
    }

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("a database");
        super::prepare(&connection, false).expect("prepared");
        connection
    }

    #[test]
    fn a_batch_answers_each_statement_in_order() {
        let mut connection = database();
        let rows = run_batch(
            &mut connection,
            &[
                statement!("CREATE TABLE t (a INTEGER, b TEXT, c BLOB)"),
                statement!(
                    "INSERT INTO t VALUES (?, ?, ?)",
                    1_i64,
                    "one",
                    vec![1_u8, 2]
                ),
                statement!(
                    "INSERT INTO t VALUES (?, ?, ?)",
                    2_i64,
                    None::<String>,
                    None::<Vec<u8>>
                ),
                statement!("SELECT a, b, c FROM t ORDER BY a"),
            ],
        )
        .expect("answers");
        assert_eq!(rows.len(), 4);
        assert_eq!(
            rows[3],
            [
                vec![
                    Value::Integer(1),
                    Value::from("one"),
                    Value::Blob(vec![1, 2])
                ],
                vec![Value::Integer(2), Value::Null, Value::Null],
            ]
        );
    }

    #[test]
    fn a_failing_batch_leaves_nothing_behind() {
        let mut connection = database();
        run_batch(
            &mut connection,
            &[statement!("CREATE TABLE t (a INTEGER UNIQUE)")],
        )
        .expect("created");
        let failed = run_batch(
            &mut connection,
            &[
                statement!("INSERT INTO t VALUES (1)"),
                statement!("INSERT INTO t VALUES (1)"),
            ],
        );
        assert!(failed.is_err());
        let rows =
            run_batch(&mut connection, &[statement!("SELECT COUNT(*) FROM t")]).expect("counted");
        assert_eq!(rows[0][0][0], Value::Integer(0));
    }

    #[test]
    fn foreign_keys_hold() {
        let mut connection = database();
        let rows = run_batch(&mut connection, &[statement!("PRAGMA foreign_keys")]).expect("read");
        assert_eq!(rows[0][0][0], Value::Integer(1));
    }

    #[test]
    fn a_request_crosses_the_wire_and_names_only_files() {
        let mut databases = One(database());
        let request = |database: &str| {
            encode(&Request {
                id: 9,
                database: database.to_owned(),
                statements: vec![statement!("SELECT 40 + ?", 2_i64)],
                remove: false,
            })
        };
        let response: Response =
            decode(&answer(&request("mail.sqlite3"), &mut databases)).expect("a response");
        assert_eq!(response.id, 9);
        assert_eq!(response.result, Ok(vec![vec![vec![Value::Integer(42)]]]));

        let refused: Response =
            decode(&answer(&request("../mail.sqlite3"), &mut databases)).expect("a response");
        assert!(refused.result.is_err());
        assert!(!is_database_name(".."));
        assert!(!is_database_name("a/b"));
        assert!(is_database_name("mail.sqlite3"));
    }
}
