mod db;
mod inbox;

use std::future::pending;
use std::time::Duration;

use mailbowox_core::MessageSummary;
use mailbowox_gateway::{Config, Roles, serve};
use serde_json::Value as Json;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

use db::{Databases, Outcome};
use inbox::{Inboxes, Watched, content};

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

/// The app hands over every account it shows new mail for, each time that list changes.
#[tauri::command]
fn watch_inboxes(app: AppHandle, inboxes: State<'_, Inboxes>, accounts: Vec<Watched>) {
    inboxes.set(accounts, move |account: &str, message: &MessageSummary| {
        notify(&app, account, message);
    });
}

/// Nothing shows while the window has focus: its list already has the new mail.
fn notify(app: &AppHandle, account: &str, message: &MessageSummary) {
    let focused = app
        .get_webview_window("main")
        .is_some_and(|window| window.is_focused().unwrap_or(false));
    if focused {
        return;
    }
    let (title, body) = content(message);
    let mut notification = app
        .notification()
        .builder()
        .body(body)
        .extra("account", account);
    // Without a title the product name shows.
    if !title.is_empty() {
        notification = notification.title(title);
    }
    if let Err(error) = notification.show() {
        eprintln!("could not show a notification: {error}");
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Closing the window leaves the app in the tray, still watching; Quit ends it.
fn tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open mailbowox", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("mailbowox")
        .menu(&Menu::with_items(app, &[&open, &quit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        // Not reported on Linux, where the menu opens the window.
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
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
        // First, as the plugin asks. The app keeps running in the tray, so launching it again
        // brings back its window instead of starting a second relay on the same databases.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_window(app)
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![db_exec, db_query, watch_inboxes])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            app.manage(Inboxes::default());
            tray(app)?;
            // A click on a notification opens the window on that account's inbox.
            let handle = app.handle().clone();
            app.notification().on_action(move |performed| {
                if performed.action_id() != "tap" {
                    return;
                }
                show_window(&handle);
                let account = performed
                    .notification()
                    .and_then(|notification| notification.extra().get("account"))
                    .and_then(Json::as_str);
                if let Some(account) = account {
                    let _ = handle.emit("open-inbox", account);
                }
            })?;
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
        .build(tauri::generate_context!())
        .expect("the desktop shell failed to start")
        .run(|_app, _event| {
            // A click on the dock icon brings back a window closed to the tray.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_window(_app);
            }
        });
}
