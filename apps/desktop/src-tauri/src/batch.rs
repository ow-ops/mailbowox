//! The store's databases on the desktop, where the web build sends its batches instead of to the
//! OPFS worker.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use mailbowox_sql::rusqlite::Connection;
use mailbowox_sql::{answer, prepare};

pub(crate) struct Files {
    open: Mutex<Open>,
}

struct Open {
    dir: PathBuf,
    connections: HashMap<String, Connection>,
}

impl Files {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self {
            open: Mutex::new(Open {
                dir,
                connections: HashMap::new(),
            }),
        }
    }

    pub(crate) fn answer(&self, bytes: &[u8]) -> Vec<u8> {
        answer(
            bytes,
            &mut *self.open.lock().unwrap_or_else(PoisonError::into_inner),
        )
    }
}

impl mailbowox_sql::Databases for Open {
    fn connection(&mut self, name: &str) -> Result<&mut Connection, String> {
        if !self.connections.contains_key(name) {
            std::fs::create_dir_all(&self.dir).map_err(|error| error.to_string())?;
            let connection =
                Connection::open(self.dir.join(name)).map_err(|error| error.to_string())?;
            prepare(&connection, true).map_err(|error| error.to_string())?;
            self.connections.insert(name.to_owned(), connection);
        }
        self.connections
            .get_mut(name)
            .ok_or_else(|| "the database vanished".to_owned())
    }

    fn remove(&mut self, name: &str) -> Result<(), String> {
        self.connections.remove(name);
        for suffix in ["", "-wal", "-shm"] {
            match std::fs::remove_file(self.dir.join(format!("{name}{suffix}"))) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(error.to_string());
                }
                _ => {}
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use mailbowox_sql::{Request, Response, Value, decode, encode, statement};

    use super::Files;

    fn request(
        id: u32,
        database: &str,
        statements: Vec<mailbowox_sql::Statement>,
        remove: bool,
    ) -> Vec<u8> {
        encode(&Request {
            id,
            database: database.to_owned(),
            statements,
            remove,
        })
    }

    fn rows(files: &Files, bytes: &[u8]) -> Result<Vec<mailbowox_sql::Rows>, String> {
        let response: Response = decode(&files.answer(bytes)).expect("a response");
        response.result
    }

    #[test]
    fn keeps_a_database_as_a_file_until_it_is_removed() {
        let dir = tempfile::tempdir().expect("temp dir");
        let files = Files::new(dir.path().join("data"));
        rows(
            &files,
            &request(
                1,
                "store.sqlite3",
                vec![
                    statement!("CREATE TABLE t (a INTEGER)"),
                    statement!("INSERT INTO t VALUES (?)", 7_i64),
                ],
                false,
            ),
        )
        .expect("written");
        assert!(dir.path().join("data/store.sqlite3").exists());

        let read = rows(
            &files,
            &request(
                2,
                "store.sqlite3",
                vec![statement!("SELECT a FROM t")],
                false,
            ),
        )
        .expect("read");
        assert_eq!(read, [vec![vec![Value::Integer(7)]]]);

        rows(&files, &request(3, "store.sqlite3", Vec::new(), true)).expect("removed");
        assert!(!dir.path().join("data/store.sqlite3").exists());
    }

    #[test]
    fn refuses_a_name_that_leaves_the_data_directory() {
        let dir = tempfile::tempdir().expect("temp dir");
        let files = Files::new(dir.path().join("data"));
        for name in ["../store.sqlite3", "a/store.sqlite3", "..", ""] {
            assert!(
                rows(
                    &files,
                    &request(1, name, vec![statement!("SELECT 1")], false)
                )
                .is_err(),
                "{name:?}"
            );
            assert!(
                rows(&files, &request(1, name, Vec::new(), true)).is_err(),
                "{name:?}"
            );
        }
    }
}
