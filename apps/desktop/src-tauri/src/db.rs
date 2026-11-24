//! The app's SQLite databases, as files in the app data directory. The web build of expo-sqlite
//! needs `SharedArrayBuffer`, which the macOS webview withholds from a custom scheme.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, params_from_iter};
use serde::Serialize;
use serde_json::{Map, Value as Json, json};

pub(crate) struct Databases {
    dir: PathBuf,
    open: Mutex<HashMap<String, Connection>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Outcome {
    rows: Vec<Map<String, Json>>,
    changes: u64,
    last_insert_row_id: i64,
}

/// JSON has no bytes, so a blob crosses as `{"hex": "…"}`.
fn bind(value: Json) -> Result<Value, String> {
    match value {
        Json::Null => Ok(Value::Null),
        Json::Bool(flag) => Ok(Value::Integer(flag.into())),
        Json::Number(number) => number
            .as_i64()
            .map(Value::Integer)
            .or_else(|| number.as_f64().map(Value::Real))
            .ok_or_else(|| format!("{number} does not fit an SQLite number")),
        Json::String(text) => Ok(Value::Text(text)),
        Json::Object(blob) => match blob.get("hex") {
            Some(Json::String(hex)) => hex::decode(hex)
                .map(Value::Blob)
                .map_err(|error| error.to_string()),
            _ => Err("a parameter object must be a blob".to_owned()),
        },
        Json::Array(_) => Err("a parameter cannot be a list".to_owned()),
    }
}

fn read(value: ValueRef<'_>) -> Json {
    match value {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(integer) => integer.into(),
        ValueRef::Real(real) => real.into(),
        ValueRef::Text(text) => String::from_utf8_lossy(text).into(),
        ValueRef::Blob(blob) => json!({ "hex": hex::encode(blob) }),
    }
}

impl Databases {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            open: Mutex::default(),
        }
    }

    /// Rolls back a transaction a reloaded page left open.
    pub(crate) fn close(&self) {
        self.open
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }

    fn with<T>(
        &self,
        name: &str,
        run: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let mut open = self.open.lock().unwrap_or_else(PoisonError::into_inner);
        if !open.contains_key(name) {
            // The name becomes a file in the data directory, and must not lead out of it.
            if Path::new(name).file_name() != Some(name.as_ref()) {
                return Err(format!("{name:?} is not a database name"));
            }
            std::fs::create_dir_all(&self.dir).map_err(|error| error.to_string())?;
            let connection =
                Connection::open(self.dir.join(name)).map_err(|error| error.to_string())?;
            open.insert(name.to_owned(), connection);
        }
        run(&open[name]).map_err(|error| error.to_string())
    }

    pub(crate) fn exec(&self, name: &str, sql: &str) -> Result<(), String> {
        self.with(name, |db| db.execute_batch(sql))
    }

    pub(crate) fn query(
        &self,
        name: &str,
        sql: &str,
        params: Vec<Json>,
    ) -> Result<Outcome, String> {
        let params = params
            .into_iter()
            .map(bind)
            .collect::<Result<Vec<_>, _>>()?;
        self.with(name, |db| {
            let mut statement = db.prepare(sql)?;
            let columns: Vec<String> = statement.column_names().map(str::to_owned).collect();
            let mut found = statement.query(params_from_iter(params))?;
            let mut rows = Vec::new();
            while let Some(row) = found.next()? {
                let mut cells = Map::new();
                for (index, column) in columns.iter().enumerate() {
                    cells.insert(column.clone(), read(row.get_ref(index)?));
                }
                rows.push(cells);
            }
            Ok(Outcome {
                rows,
                changes: db.changes(),
                last_insert_row_id: db.last_insert_rowid(),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn databases() -> (Databases, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("temp dir");
        (Databases::new(dir.path().join("data")), dir)
    }

    #[test]
    fn runs_the_statements_the_app_opens_a_database_with() {
        let (databases, _dir) = databases();
        databases
            .exec(
                "mail.db",
                "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;",
            )
            .expect("pragmas");
        databases
            .exec("mail.db", "BEGIN; CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); PRAGMA user_version = 1; COMMIT;")
            .expect("migration");
        let version = databases
            .query("mail.db", "PRAGMA user_version", Vec::new())
            .expect("version");
        assert_eq!(version.rows[0]["user_version"], json!(1));
    }

    #[test]
    fn reports_the_inserted_row_and_returns_each_type() {
        let (databases, _dir) = databases();
        databases
            .exec("mail.db", "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, size REAL, seen INTEGER, data BLOB)")
            .expect("table");
        let params = vec![
            json!("a"),
            json!(1.5),
            json!(true),
            json!({ "hex": "00ff" }),
        ];
        let inserted = databases
            .query(
                "mail.db",
                "INSERT INTO t (name, size, seen, data) VALUES (?, ?, ?, ?)",
                params,
            )
            .expect("insert");
        assert_eq!((inserted.changes, inserted.last_insert_row_id), (1, 1));

        let found = databases
            .query(
                "mail.db",
                "SELECT name, size, seen, data, NULL AS empty FROM t WHERE id = ?1",
                vec![json!(1)],
            )
            .expect("select");
        assert_eq!(
            Json::from(found.rows),
            json!([{ "name": "a", "size": 1.5, "seen": 1, "data": { "hex": "00ff" }, "empty": null }])
        );
    }

    #[test]
    fn keeps_a_transaction_open_across_calls() {
        let (databases, _dir) = databases();
        databases
            .exec("mail.db", "CREATE TABLE t (id INTEGER)")
            .expect("table");
        databases.exec("mail.db", "BEGIN").expect("begin");
        databases
            .query("mail.db", "INSERT INTO t VALUES (1)", Vec::new())
            .expect("insert");
        databases.exec("mail.db", "ROLLBACK").expect("rollback");
        let left = databases
            .query("mail.db", "SELECT id FROM t", Vec::new())
            .expect("select");
        assert_eq!(left.rows.len(), 0);
    }

    #[test]
    fn closing_rolls_back_what_a_page_left_open() {
        let (databases, _dir) = databases();
        databases
            .exec(
                "mail.db",
                "CREATE TABLE t (id INTEGER); BEGIN; INSERT INTO t VALUES (1);",
            )
            .expect("open transaction");
        databases.close();
        databases
            .exec("mail.db", "BEGIN; COMMIT;")
            .expect("a new transaction");
        let left = databases
            .query("mail.db", "SELECT id FROM t", Vec::new())
            .expect("select");
        assert_eq!(left.rows.len(), 0);
    }

    #[test]
    fn refuses_a_name_that_leaves_the_data_directory() {
        let (databases, _dir) = databases();
        for name in ["../mail.db", "a/mail.db", "..", ""] {
            assert!(databases.exec(name, "SELECT 1").is_err(), "{name:?}");
        }
    }
}
