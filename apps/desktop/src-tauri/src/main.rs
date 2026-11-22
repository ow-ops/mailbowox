mod db;

use std::future::pending;
use std::time::Duration;

use mailbowox_gateway::{Config, Roles, serve};
use serde_json::Value as Json;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{Manager, State, Url, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use db::{Databases, Outcome};

// Tauri hands a command its state by value.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
fn db_exec(databases: State<'_, Databases>, name: &str, sql: &str) -> Result<(), String> {
    databases.exec(name, sql)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
fn db_query(
    databases: State<'_, Databases>,
    name: &str,
    sql: &str,
    params: Vec<Json>,
) -> Result<Outcome, String> {
    databases.query(name, sql, params)
}

/// Every page the window loads is handed the relay, so it loads the app and nothing else. A mail
/// body is an `about:srcdoc` frame.
fn is_app(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        // Windows serves the app from here, and the dev server is on localhost.
        "http" => {
            url.host_str() == Some("tauri.localhost")
                || (cfg!(dev) && url.host_str() == Some("localhost"))
        }
        _ => false,
    }
}

fn relay(token: String) -> Config {
    Config {
        roles: Roles {
            api: false,
            relay: true,
            push: false,
        },
        database_url: "sqlite::memory:".to_owned(),
        tokens: vec![token],
        allowed_ports: (1..=u16::MAX).collect(),
        allow_private_targets: true,
        trust_proxy: false,
        allowed_origins: Vec::new(),
        max_connections_per_token: 32,
        idle_timeout: Duration::from_mins(30),
        push: None,
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![db_exec, db_query])
        .setup(|app| {
            // A dev run has a webview store of its own, so it gets databases of its own: the app
            // deletes what belongs to an account its store does not list.
            let data = app.path().app_data_dir()?;
            app.manage(Databases::new(if cfg!(dev) {
                data.join("dev")
            } else {
                data
            }));
            // The web build cannot open TCP, so it goes through the gateway's relay on loopback.
            let token = uuid::Uuid::new_v4().simple().to_string();
            let listener =
                tauri::async_runtime::block_on(tokio::net::TcpListener::bind(("127.0.0.1", 0)))?;
            let handed = serde_json::json!({
                "url": format!("http://{}", listener.local_addr()?),
                "token": token,
            });
            tauri::async_runtime::spawn(async move {
                if let Err(error) = serve(relay(token), listener, None, pending()).await {
                    eprintln!("the relay stopped: {error}");
                }
            });
            let window = app
                .config()
                .app
                .windows
                .first()
                .ok_or("tauri.conf.json declares no window")?;
            let opener = app.handle().clone();
            WebviewWindowBuilder::from_config(app.handle(), window)?
                .initialization_script(format!("window.__MAILBOWOX_RELAY__ = {handed};"))
                .on_navigation(is_app)
                .on_new_window(move |url, _| {
                    if matches!(url.scheme(), "http" | "https" | "mailto")
                        && let Err(error) = opener.opener().open_url(url.as_str(), None::<&str>)
                    {
                        eprintln!("could not open {url}: {error}");
                    }
                    NewWindowResponse::Deny
                })
                .on_page_load(|webview, payload| {
                    if payload.event() == PageLoadEvent::Started {
                        webview.state::<Databases>().close();
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the desktop shell failed to start");
}
