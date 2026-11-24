//! The web build's databases, in OPFS, which only a dedicated worker can open
//! synchronously. Batches arrive on a `MessagePort` and are answered in order.
#![cfg(target_family = "wasm")]

use std::{cell::RefCell, collections::HashMap};

use mailbowox_sql::{Response, answer, encode, prepare};
use rsqlite_vfs::VfsFilesManager as _;
use rusqlite::Connection;
use sqlite_wasm_rs::WasmOsCallback;
use sqlite_wasm_vfs::sahpool::{OpfsSAHPoolCfg, OpfsSAHPoolUtil, install};
use wasm_bindgen::prelude::*;
use web_sys::{MessageEvent, MessagePort};

const INSTALL_ATTEMPTS: usize = 6;
const INSTALL_RETRY_MS: i32 = 250;

struct Databases {
    pool: Option<OpfsSAHPoolUtil>,
    open: HashMap<String, Connection>,
}

thread_local! {
    static DATABASES: RefCell<Option<Databases>> = const { RefCell::new(None) };
}

fn warn(message: &str) {
    web_sys::console::warn_1(&JsValue::from_str(message));
}

async fn pause(milliseconds: i32) {
    let promise = js_sys::Promise::new(&mut |resolve, _| {
        let scope: web_sys::WorkerGlobalScope = js_sys::global().unchecked_into();
        let _ = scope.set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, milliseconds);
    });
    let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
}

impl Databases {
    fn open(&self, name: &str) -> Result<Connection, String> {
        let connection = if self.pool.is_some() {
            Connection::open(name)
        } else {
            Connection::open_in_memory()
        }
        .map_err(|error| error.to_string())?;
        prepare(&connection, false).map_err(|error| error.to_string())?;
        Ok(connection)
    }
}

impl mailbowox_sql::Databases for Databases {
    fn connection(&mut self, name: &str) -> Result<&mut Connection, String> {
        if !self.open.contains_key(name) {
            let opened = self.open(name)?;
            self.open.insert(name.to_owned(), opened);
        }
        self.open
            .get_mut(name)
            .ok_or_else(|| "the database vanished".to_owned())
    }

    fn remove(&mut self, name: &str) -> Result<(), String> {
        self.open.remove(name);
        if let Some(pool) = &self.pool {
            for suffix in ["", "-journal"] {
                let _ = pool.remove(&format!("{name}{suffix}"));
            }
        }
        Ok(())
    }
}

fn respond(bytes: &[u8]) -> Vec<u8> {
    DATABASES.with_borrow_mut(|databases| match databases.as_mut() {
        Some(databases) => answer(bytes, databases),
        None => encode(&Response {
            id: 0,
            result: Err("the worker is not serving".to_owned()),
        }),
    })
}

/// Without OPFS the databases are kept in memory, and a warning says so.
#[wasm_bindgen]
pub async fn serve(port: MessagePort) {
    let mut pool = None;
    for attempt in 0..INSTALL_ATTEMPTS {
        match install::<WasmOsCallback>(&OpfsSAHPoolCfg::default(), true).await {
            Ok(installed) => {
                pool = Some(installed);
                break;
            }
            Err(error) if attempt + 1 == INSTALL_ATTEMPTS => warn(&format!(
                "mail cannot be kept on this device here, keeping it in memory: {error}"
            )),
            // The worker that had the files before may still be closing.
            Err(_) => pause(INSTALL_RETRY_MS).await,
        }
    }
    DATABASES.with_borrow_mut(|databases| {
        databases.get_or_insert(Databases {
            pool,
            open: HashMap::new(),
        });
    });

    let reply = port.clone();
    let on_message = Closure::<dyn FnMut(MessageEvent)>::new(move |event: MessageEvent| {
        let bytes = js_sys::Uint8Array::new(&event.data()).to_vec();
        let encoded = js_sys::Uint8Array::from(respond(&bytes).as_slice());
        let transfer = js_sys::Array::of1(&encoded.buffer());
        if reply
            .post_message_with_transferable(&encoded, &transfer)
            .is_err()
        {
            warn("the database could not answer");
        }
    });
    port.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
    on_message.forget();
    port.start();
}
