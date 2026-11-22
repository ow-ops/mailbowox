#![allow(clippy::unwrap_used)]

use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Extension;
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Request, Response, StatusCode};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use futures_util::{SinkExt, StreamExt};
use mailbowox_gateway::{ApnsConfig, Config, PushConfig, Roles, app};
use ring::rand::SystemRandom;
use ring::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair};
use serde_json::{Value, json};
use sqlx::Connection;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::{Error, Message};
use tower::ServiceExt;

const ID: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/// SQLite in `dir`, or with `TEST_POSTGRES_URL` a Postgres schema named after `dir`, so a
/// gateway restarted on the same `dir` finds its data again.
async fn database_url(dir: &Path) -> String {
    let Ok(base) = std::env::var("TEST_POSTGRES_URL") else {
        return format!("sqlite://{}/gateway.db?mode=rwc", dir.display());
    };
    let name = dir.file_name().unwrap().to_string_lossy().to_lowercase();
    let schema: String = std::iter::once('t')
        .chain(name.chars().filter(char::is_ascii_alphanumeric))
        .collect();
    let mut admin = sqlx::PgConnection::connect(&base).await.unwrap();
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "CREATE SCHEMA IF NOT EXISTS {schema}"
    )))
    .execute(&mut admin)
    .await
    .unwrap();
    let joiner = if base.contains('?') { '&' } else { '?' };
    format!("{base}{joiner}options=-csearch_path%3D{schema}")
}

/// Everything the gateway wrote under `dir`, to check what reaches the disk.
fn stored(dir: &Path) -> String {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| {
            String::from_utf8_lossy(&std::fs::read(entry.unwrap().path()).unwrap()).into_owned()
        })
        .collect()
}

async fn config(dir: &Path, allow_private: bool, ports: Vec<u16>) -> Config {
    Config {
        roles: Roles::ALL,
        database_url: database_url(dir).await,
        tokens: vec!["secret".into(), "other".into()],
        allowed_ports: ports,
        allow_private_targets: allow_private,
        trust_proxy: false,
        allowed_origins: vec!["https://app.example".parse().unwrap()],
        max_connections_per_token: 2,
        idle_timeout: Duration::from_secs(60),
        push: None,
    }
}

async fn serve(config: Config) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app(config).await.unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await });
    addr
}

async fn echo_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let mut buf = [0; 1024];
                while let Ok(n @ 1..) = socket.read(&mut buf).await {
                    if socket.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
    port
}

fn relay_url(gateway: SocketAddr, host: &str, port: u16) -> String {
    format!("ws://{gateway}/relay?host={host}&port={port}")
}

/// A relay request offering the token the way the app does, as a subprotocol.
fn relay_request(url: &str, token: &str) -> Request<()> {
    let mut request = url.into_client_request().unwrap();
    let protocols = format!("mailbowox-relay, token-{}", hex::encode(token));
    request
        .headers_mut()
        .insert("sec-websocket-protocol", protocols.parse().unwrap());
    request
}

fn status(error: Error) -> StatusCode {
    match error {
        Error::Http(response) => response.status(),
        other => panic!("expected an HTTP rejection, got {other:?}"),
    }
}

#[tokio::test]
async fn relay_rejects_bad_token() {
    let dir = tempfile::tempdir().unwrap();
    let gateway = serve(config(dir.path(), true, vec![443]).await).await;
    let error = connect_async(relay_request(&relay_url(gateway, "127.0.0.1", 443), "nope"))
        .await
        .unwrap_err();
    assert_eq!(status(error), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn relay_ignores_a_token_in_the_url() {
    let dir = tempfile::tempdir().unwrap();
    let echo = echo_server().await;
    let gateway = serve(config(dir.path(), true, vec![echo]).await).await;
    let url = format!("{}&token=secret", relay_url(gateway, "127.0.0.1", echo));
    let error = connect_async(url).await.unwrap_err();
    assert_eq!(status(error), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn relay_selects_its_subprotocol_without_echoing_the_token() {
    let dir = tempfile::tempdir().unwrap();
    let echo = echo_server().await;
    let gateway = serve(config(dir.path(), true, vec![echo]).await).await;
    let request = relay_request(&relay_url(gateway, "127.0.0.1", echo), "secret");
    let (_, response) = connect_async(request).await.unwrap();
    let selected = response.headers()["sec-websocket-protocol"]
        .to_str()
        .unwrap();
    assert_eq!(selected, "mailbowox-relay");
}

#[tokio::test]
async fn relay_rejects_disallowed_port() {
    let dir = tempfile::tempdir().unwrap();
    let gateway = serve(config(dir.path(), true, vec![443]).await).await;
    let error = connect_async(relay_request(
        &relay_url(gateway, "127.0.0.1", 22),
        "secret",
    ))
    .await
    .unwrap_err();
    assert_eq!(status(error), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn relay_refuses_private_targets_by_default() {
    let dir = tempfile::tempdir().unwrap();
    let echo = echo_server().await;
    let gateway = serve(config(dir.path(), false, vec![echo]).await).await;
    for host in [
        "127.0.0.1",
        "localhost",
        "10.0.0.1",
        "169.254.169.254",
        "[::1]",
        "[fd00::1]",
        "[::ffff:127.0.0.1]",
    ] {
        let error = connect_async(relay_request(&relay_url(gateway, host, echo), "secret"))
            .await
            .unwrap_err();
        assert_eq!(status(error), StatusCode::FORBIDDEN, "{host}");
    }
}

#[tokio::test]
async fn relay_echoes_binary_and_rejects_text() {
    let dir = tempfile::tempdir().unwrap();
    let echo = echo_server().await;
    let gateway = serve(config(dir.path(), true, vec![echo]).await).await;
    let (mut ws, _) = connect_async(relay_request(
        &relay_url(gateway, "127.0.0.1", echo),
        "secret",
    ))
    .await
    .unwrap();
    ws.send(Message::Binary(vec![1, 2, 3].into()))
        .await
        .unwrap();
    let reply = ws.next().await.unwrap().unwrap();
    assert_eq!(reply, Message::Binary(vec![1, 2, 3].into()));
    ws.send(Message::Text("hello".into())).await.unwrap();
    loop {
        match ws.next().await {
            Some(Ok(Message::Close(_)) | Err(_)) | None => break,
            Some(Ok(_)) => {}
        }
    }
}

#[tokio::test]
async fn relay_limits_connections_per_token() {
    let dir = tempfile::tempdir().unwrap();
    let echo = echo_server().await;
    let gateway = serve(config(dir.path(), true, vec![echo]).await).await;
    let url = relay_url(gateway, "127.0.0.1", echo);
    let _first = connect_async(relay_request(&url, "secret")).await.unwrap();
    let _second = connect_async(relay_request(&url, "secret")).await.unwrap();
    let error = connect_async(relay_request(&url, "secret"))
        .await
        .unwrap_err();
    assert_eq!(status(error), StatusCode::TOO_MANY_REQUESTS);
    // Another token has its own budget.
    connect_async(relay_request(
        &relay_url(gateway, "127.0.0.1", echo),
        "other",
    ))
    .await
    .unwrap();
}

/// The rate limits key on the peer address, which `oneshot` requests do not carry.
fn with_peer(router: Router) -> Router {
    router.layer(Extension(ConnectInfo(SocketAddr::from((
        [203, 0, 113, 7],
        50000,
    )))))
}

async fn vault_app(dir: &Path) -> Router {
    with_peer(app(config(dir, false, vec![443]).await).await.unwrap())
}

async fn put(router: &Router, auth: &str, if_match: Option<&str>, body: &[u8]) -> Response<Body> {
    let mut request =
        Request::put(format!("/vault/{ID}")).header("authorization", format!("Bearer {auth}"));
    if let Some(version) = if_match {
        request = request.header("if-match", version);
    }
    router
        .clone()
        .oneshot(request.body(Body::from(body.to_vec())).unwrap())
        .await
        .unwrap()
}

async fn get(router: &Router, auth: &str) -> Response<Body> {
    let request =
        Request::get(format!("/vault/{ID}")).header("authorization", format!("Bearer {auth}"));
    router
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

fn etag(response: &Response<Body>) -> &str {
    response.headers()["etag"].to_str().unwrap()
}

#[tokio::test]
async fn vault_create_get_update() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    let auth = "correct-horse-battery";
    assert_eq!(get(&router, auth).await.status(), StatusCode::NOT_FOUND);

    let created = put(&router, auth, None, b"one").await;
    assert_eq!(created.status(), StatusCode::CREATED);
    assert_eq!(etag(&created), "\"1\"");

    let fetched = get(&router, auth).await;
    assert_eq!(etag(&fetched), "\"1\"");
    assert_eq!(
        to_bytes(fetched.into_body(), usize::MAX).await.unwrap(),
        "one"
    );

    let updated = put(&router, auth, Some("\"1\""), b"two").await;
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(etag(&updated), "\"2\"");
    let fetched = get(&router, auth).await;
    assert_eq!(
        to_bytes(fetched.into_body(), usize::MAX).await.unwrap(),
        "two"
    );

    // Only a hash of the auth secret reaches the disk.
    assert!(!stored(dir.path()).contains(auth));
}

async fn delete_vault(router: &Router, auth: &str) -> StatusCode {
    let request =
        Request::delete(format!("/vault/{ID}")).header("authorization", format!("Bearer {auth}"));
    router
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn a_deleted_vault_is_gone_for_every_device_and_cannot_be_written_back() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    let auth = "correct-horse-battery";
    assert_eq!(delete_vault(&router, auth).await, StatusCode::NOT_FOUND);
    put(&router, auth, None, b"accounts and passwords").await;

    assert_eq!(delete_vault(&router, "wrong").await, StatusCode::FORBIDDEN);
    assert_eq!(get(&router, auth).await.status(), StatusCode::OK);

    assert_eq!(delete_vault(&router, auth).await, StatusCode::NO_CONTENT);
    assert_eq!(get(&router, auth).await.status(), StatusCode::GONE);
    assert_eq!(
        put(&router, auth, None, b"again").await.status(),
        StatusCode::GONE
    );
    assert_eq!(
        put(&router, auth, Some("\"1\""), b"again").await.status(),
        StatusCode::GONE
    );
    assert_eq!(delete_vault(&router, auth).await, StatusCode::NO_CONTENT);
    // The blob itself is not kept.
    assert!(!stored(dir.path()).contains("accounts and passwords"));
}

#[tokio::test]
async fn one_client_can_leave_only_a_few_link_messages_waiting() {
    // The count resets on the clock's two-minute boundaries; a slow run must not straddle one.
    let into_window = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        % 120;
    if into_window > 90 {
        tokio::time::sleep(Duration::from_secs(121 - into_window)).await;
    }
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    let id = |n: usize| format!("{n:064x}");
    for n in 0..20 {
        assert_eq!(
            link(&router, "POST", &id(n), b"key").await.status(),
            StatusCode::CREATED
        );
    }
    assert_eq!(
        link(&router, "POST", &id(20), b"key").await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    // Reading is not held to the same count.
    assert_eq!(
        link(&router, "GET", &id(0), b"").await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn vault_version_conflict_returns_current_etag() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    put(&router, "a", Some("0"), b"one").await;
    let stale = put(&router, "a", Some("0"), b"clobber").await;
    assert_eq!(stale.status(), StatusCode::PRECONDITION_FAILED);
    assert_eq!(etag(&stale), "\"1\"");
    let wrong = put(&router, "a", Some("7"), b"clobber").await;
    assert_eq!(wrong.status(), StatusCode::PRECONDITION_FAILED);
    let fetched = get(&router, "a").await;
    assert_eq!(
        to_bytes(fetched.into_body(), usize::MAX).await.unwrap(),
        "one"
    );
}

#[tokio::test]
async fn vault_wrong_auth_is_forbidden() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    put(&router, "a", None, b"one").await;
    assert_eq!(get(&router, "b").await.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        put(&router, "b", Some("1"), b"x").await.status(),
        StatusCode::FORBIDDEN
    );
    let request = Request::get(format!("/vault/{ID}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router.clone().oneshot(request).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn vault_enforces_size_limit_and_id_format() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    let big = vec![0; (1 << 20) + 1];
    assert_eq!(
        put(&router, "a", None, &big).await.status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let max = vec![0; 1 << 20];
    assert_eq!(
        put(&router, "a", None, &max).await.status(),
        StatusCode::CREATED
    );
    let request = Request::get("/vault/../etc")
        .header("authorization", "Bearer a")
        .body(Body::empty())
        .unwrap();
    assert_ne!(
        router.clone().oneshot(request).await.unwrap().status(),
        StatusCode::OK
    );
    let request = Request::get("/vault/short")
        .header("authorization", "Bearer a")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router.clone().oneshot(request).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn vault_cors_and_health() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    let preflight = Request::options(format!("/vault/{ID}"))
        .header("origin", "https://app.example")
        .header("access-control-request-method", "PUT")
        .header("access-control-request-headers", "authorization,if-match")
        .body(Body::empty())
        .unwrap();
    let response = router.clone().oneshot(preflight).await.unwrap();
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        "https://app.example"
    );

    let foreign = Request::options(format!("/vault/{ID}"))
        .header("origin", "https://evil.example")
        .header("access-control-request-method", "PUT")
        .body(Body::empty())
        .unwrap();
    let response = router.clone().oneshot(foreign).await.unwrap();
    assert!(
        response
            .headers()
            .get("access-control-allow-origin")
            .is_none()
    );

    let health = Request::get("/healthz")
        .header("origin", "https://self-hosted.example")
        .body(Body::empty())
        .unwrap();
    let health = router.oneshot(health).await.unwrap();
    assert_eq!(health.status(), StatusCode::OK);
    assert_eq!(health.headers()["access-control-allow-origin"], "*");
}

#[tokio::test]
async fn relay_check_tells_any_origin_whether_the_access_code_is_good() {
    let dir = tempfile::tempdir().unwrap();
    let router = app(config(dir.path(), false, vec![443]).await)
        .await
        .unwrap();
    for (code, expected) in [
        ("secret", StatusCode::NO_CONTENT),
        ("other", StatusCode::NO_CONTENT),
        ("wrong", StatusCode::UNAUTHORIZED),
        ("", StatusCode::UNAUTHORIZED),
    ] {
        let request = Request::post("/relay/check")
            .header("origin", "https://self-hosted.example")
            .header("content-type", "text/plain;charset=UTF-8")
            .body(Body::from(code))
            .unwrap();
        let response = router.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), expected, "{code:?}");
        assert_eq!(response.headers()["access-control-allow-origin"], "*");
    }
}

/// dev/mailbox's Stalwart, which CI reaches by its compose service name.
fn imap_host() -> String {
    std::env::var("MAILBOWOX_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".into())
}

fn local_imap() -> bool {
    let host = imap_host();
    let up = (host.as_str(), 1143)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .is_some_and(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_ok());
    if up {
        return true;
    }
    assert!(
        std::env::var_os("CI").is_none(),
        "no IMAP server on {host}:1143 (CI runs dev/mailbox/setup.sh)"
    );
    eprintln!("skipped: no IMAP server on {host}:1143 (run dev/mailbox/setup.sh)");
    false
}

/// A throwaway APNs signing key: enough for the gateway to accept iOS registrations.
fn apns_key(dir: &Path) -> PathBuf {
    let pkcs8 =
        EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &SystemRandom::new())
            .unwrap();
    let pem = format!(
        "-----BEGIN PRIVATE KEY-----\n{}\n-----END PRIVATE KEY-----\n",
        STANDARD.encode(pkcs8.as_ref())
    );
    let path = dir.join("apns.p8");
    std::fs::write(&path, pem).unwrap();
    path
}

async fn push_config(dir: &Path, allow_private: bool, max_watchers_per_device: usize) -> Config {
    let mut config = config(dir, allow_private, vec![1143]).await;
    config.push = Some(PushConfig {
        secret_key: [9; 32],
        old_secret_keys: vec![],
        capacity: 100,
        apns: Some(ApnsConfig {
            key_file: apns_key(dir),
            key_id: "KEY1234567".into(),
            team_id: "TEAM123456".into(),
            topic: "eu.owops.mailbowox".into(),
        }),
        fcm_credentials_file: None,
        max_watchers_per_device,
    });
    config
}

async fn push_app(dir: &Path, allow_private: bool, max_watchers_per_device: usize) -> Router {
    let config = push_config(dir, allow_private, max_watchers_per_device).await;
    with_peer(app(config).await.unwrap())
}

fn registration(token: &str, user: &str, password: &str) -> Value {
    let email = format!("{user}@mailbowox.test");
    json!({
        "platform": "ios-sandbox",
        "token": token,
        "email": email,
        "host": imap_host(),
        "port": 1143,
        "security": "plain",
        "username": email,
        "password": password,
    })
}

async fn register(router: &Router, body: &Value) -> Response<Body> {
    let request = Request::post("/push/register")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    router.clone().oneshot(request).await.unwrap()
}

async fn link(router: &Router, method: &str, id: &str, body: &[u8]) -> Response<Body> {
    let request = Request::builder()
        .method(method)
        .uri(format!("/link/{id}"))
        .body(Body::from(body.to_vec()))
        .unwrap();
    router.clone().oneshot(request).await.unwrap()
}

async fn registered(router: &Router, body: &Value) -> (String, String) {
    let response = register(router, body).await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    (
        body["id"].as_str().unwrap().to_owned(),
        body["secret"].as_str().unwrap().to_owned(),
    )
}

async fn unregister(router: &Router, id: &str, secret: Option<&str>) -> StatusCode {
    let mut request = Request::delete(format!("/push/{id}"));
    if let Some(secret) = secret {
        request = request.header("authorization", format!("Bearer {secret}"));
    }
    let request = request.body(Body::empty()).unwrap();
    router.clone().oneshot(request).await.unwrap().status()
}

#[tokio::test]
async fn push_is_unavailable_without_a_secret_key() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    let response = register(&router, &registration("abcd", "alice", "x")).await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn push_refuses_bad_registrations_before_logging_in() {
    let dir = tempfile::tempdir().unwrap();
    let router = push_app(dir.path(), false, 10).await;
    let mut cases = vec![
        (
            registration("not hex", "alice", "x"),
            StatusCode::BAD_REQUEST,
        ),
        (registration("abcd", "alice", "x"), StatusCode::FORBIDDEN),
    ];
    let mut android = registration("abc:def", "alice", "x");
    android["platform"] = "android".into();
    cases.push((android, StatusCode::SERVICE_UNAVAILABLE));
    let mut port = registration("abcd", "alice", "x");
    port["port"] = 22.into();
    cases.push((port, StatusCode::FORBIDDEN));
    let mut private = registration("abcd", "alice", "x");
    private["security"] = "tls".into();
    cases.push((private, StatusCode::FORBIDDEN));
    for (body, expected) in cases {
        assert_eq!(register(&router, &body).await.status(), expected, "{body}");
    }
    assert_eq!(
        unregister(&router, "short", Some("x")).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        unregister(&router, &"ab".repeat(16), None).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        unregister(&router, &"ab".repeat(16), Some("x")).await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn push_registration_is_sealed_and_survives_a_restart() {
    if !local_imap() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let router = push_app(dir.path(), true, 10).await;
    let (id, secret) = registered(&router, &registration("abcd", "alice", "mailbowox-dev")).await;

    let stored = stored(dir.path());
    assert!(!stored.contains("mailbowox-dev") && !stored.contains("alice"));
    assert!(
        !stored.contains(&secret),
        "the secret is stored in the clear"
    );

    let restarted = push_app(dir.path(), true, 10).await;
    assert_eq!(
        unregister(&restarted, &id, Some(&secret)).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        unregister(&restarted, &id, Some(&secret)).await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn push_unregistering_needs_the_registrations_own_secret() {
    if !local_imap() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let router = push_app(dir.path(), true, 10).await;
    let (alice, alice_secret) =
        registered(&router, &registration("abcd", "alice", "mailbowox-dev")).await;
    let (_, bob_secret) = registered(&router, &registration("ef01", "bob", "mailbowox-dev")).await;
    assert_ne!(alice_secret, bob_secret);

    assert_eq!(
        unregister(&router, &alice, None).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        unregister(&router, &alice, Some(&bob_secret)).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        unregister(&router, &alice, Some(&alice_secret)).await,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn push_refuses_a_wrong_password() {
    if !local_imap() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let router = push_app(dir.path(), true, 10).await;
    let response = register(&router, &registration("abcd", "alice", "wrong")).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn push_caps_accounts_per_device_and_replaces_repeats() {
    if !local_imap() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let router = push_app(dir.path(), true, 1).await;
    let alice = registration("abcd", "alice", "mailbowox-dev");
    let (first, first_secret) = registered(&router, &alice).await;
    let (second, second_secret) = registered(&router, &alice).await;
    assert_eq!(
        unregister(&router, &first, Some(&first_secret)).await,
        StatusCode::NOT_FOUND
    );

    let bob = registration("abcd", "bob", "mailbowox-dev");
    assert_eq!(
        register(&router, &bob).await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    registered(&router, &registration("ef01", "bob", "mailbowox-dev")).await;
    assert_eq!(
        unregister(&router, &second, Some(&second_secret)).await,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn link_is_read_once() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    assert_eq!(
        link(&router, "GET", ID, b"").await.status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        link(&router, "POST", ID, b"key").await.status(),
        StatusCode::CREATED
    );
    let fetched = link(&router, "GET", ID, b"").await;
    assert_eq!(fetched.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(fetched.into_body(), usize::MAX).await.unwrap(),
        "key"
    );
    assert_eq!(
        link(&router, "GET", ID, b"").await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn link_keeps_the_first_message() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    link(&router, "POST", ID, b"first").await;
    assert_eq!(
        link(&router, "POST", ID, b"second").await.status(),
        StatusCode::CONFLICT
    );
    let fetched = link(&router, "GET", ID, b"").await;
    assert_eq!(
        to_bytes(fetched.into_body(), usize::MAX).await.unwrap(),
        "first"
    );
}

#[tokio::test]
async fn link_enforces_size_limit_and_id_format() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    assert_eq!(
        link(&router, "POST", ID, &[0; 4097]).await.status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        link(&router, "POST", ID, b"").await.status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        link(&router, "POST", "short", b"key").await.status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        link(&router, "GET", "short", b"").await.status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        link(&router, "POST", ID, &[0; 4096]).await.status(),
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn link_allows_cross_origin_post() {
    let dir = tempfile::tempdir().unwrap();
    let router = vault_app(dir.path()).await;
    let preflight = Request::options(format!("/link/{ID}"))
        .header("origin", "https://app.example")
        .header("access-control-request-method", "POST")
        .body(Body::empty())
        .unwrap();
    let response = router.oneshot(preflight).await.unwrap();
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        "https://app.example"
    );
}

#[tokio::test]
async fn roles_pick_the_routes() {
    let dir = tempfile::tempdir().unwrap();
    let request = |uri: &str| Request::get(uri).body(Body::empty()).unwrap();

    let mut relay = config(dir.path(), false, vec![443]).await;
    relay.roles = Roles {
        api: false,
        relay: true,
        push: false,
    };
    relay.database_url = format!("sqlite://{}/relay.db?mode=rwc", dir.path().display());
    let router = with_peer(app(relay).await.unwrap());
    let vault = router
        .clone()
        .oneshot(request(&format!("/vault/{ID}")))
        .await
        .unwrap();
    assert_eq!(vault.status(), StatusCode::NOT_FOUND);
    let health = router.oneshot(request("/healthz")).await.unwrap();
    assert_eq!(health.status(), StatusCode::OK);
    assert!(
        !dir.path().join("relay.db").exists(),
        "a relay-only gateway opened the database"
    );

    let mut api = config(dir.path(), false, vec![443]).await;
    api.roles = Roles {
        api: true,
        relay: false,
        push: false,
    };
    let router = with_peer(app(api).await.unwrap());
    let relay = router
        .clone()
        .oneshot(request("/relay?host=x&port=443&token=secret"))
        .await
        .unwrap();
    assert_eq!(relay.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        link(&router, "POST", ID, b"key").await.status(),
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn push_registration_is_rate_limited_per_client() {
    let dir = tempfile::tempdir().unwrap();
    let config = push_config(dir.path(), false, 10).await;
    let gateway = app(config).await.unwrap();
    let peer = |last| Extension(ConnectInfo(SocketAddr::from(([198, 51, 100, last], 50000))));
    let router = gateway.clone().layer(peer(1));
    let bad = registration("not hex", "alice", "x");
    for _ in 0..5 {
        assert_eq!(
            register(&router, &bad).await.status(),
            StatusCode::BAD_REQUEST
        );
    }
    let limited = register(&router, &bad).await;
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(limited.headers().contains_key("retry-after"));

    let other = gateway.layer(peer(2));
    assert_eq!(
        register(&other, &bad).await.status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn gateways_sharing_postgres_share_the_registration_limit() {
    if std::env::var("TEST_POSTGRES_URL").is_err() {
        eprintln!("skipped: no TEST_POSTGRES_URL");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let first = app(push_config(dir.path(), false, 10).await).await.unwrap();
    let second = app(push_config(dir.path(), false, 10).await).await.unwrap();
    let peer = Extension(ConnectInfo(SocketAddr::from(([198, 51, 100, 1], 50000))));
    let (first, second) = (first.layer(peer), second.layer(peer));
    let bad = registration("not hex", "alice", "x");
    for _ in 0..3 {
        register(&first, &bad).await;
    }
    for _ in 0..2 {
        assert_eq!(
            register(&second, &bad).await.status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        register(&first, &bad).await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[tokio::test]
async fn metrics_are_served_on_their_own_listener() {
    let dir = tempfile::tempdir().unwrap();
    let public = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let metrics = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (public_addr, metrics_addr) = (public.local_addr().unwrap(), metrics.local_addr().unwrap());
    let config = config(dir.path(), false, vec![443]).await;
    // serve's future is not Send, so it runs on this thread beside the checks.
    let local = tokio::task::LocalSet::new();
    local.spawn_local(mailbowox_gateway::serve(
        config,
        public,
        Some(metrics),
        std::future::pending(),
    ));
    local
        .run_until(async {
            let client = reqwest::Client::new();
            let health = client
                .get(format!("http://{public_addr}/healthz"))
                .send()
                .await
                .unwrap();
            assert_eq!(health.status(), StatusCode::OK);
            client
                .get(format!("http://{public_addr}/vault/{ID}/identifying-path"))
                .send()
                .await
                .unwrap();
            let page = client
                .get(format!("http://{metrics_addr}/metrics"))
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(page.contains("axum_http_requests_total"), "{page}");
            assert!(!page.contains("identifying-path"), "{page}");
            let public_metrics = client
                .get(format!("http://{public_addr}/metrics"))
                .send()
                .await
                .unwrap();
            assert_eq!(public_metrics.status(), StatusCode::NOT_FOUND);
        })
        .await;
}
