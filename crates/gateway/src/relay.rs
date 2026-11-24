//! WebSocket-to-TCP pipe. TLS ends in the browser, so the gateway only moves ciphertext.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade, close_code};
use axum::extract::{Query, State};
use axum::http::header::SEC_WEBSOCKET_PROTOCOL;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, lookup_host};
use tokio::time::{sleep, timeout};
use tracing::{debug, info};

use crate::AppState;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long one side may take to accept what the other sent, before the pipe is given up.
const WRITE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_MESSAGE_BYTES: usize = 1 << 20;

#[derive(Deserialize)]
pub(crate) struct Params {
    /// The mail server to connect to.
    host: String,
    /// One of the ports the gateway allows.
    port: u16,
}

/// The subprotocol the gateway selects. Browsers can't set WebSocket headers but can offer
/// subprotocols, so the token rides in one as `token-` and its hex, not in the URL, which proxies
/// log.
const PROTOCOL: &str = "mailbowox-relay";
const TOKEN_PREFIX: &str = "token-";

fn offered_token(headers: &HeaderMap) -> Option<String> {
    let hex = headers
        .get_all(SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .find_map(|protocol| protocol.trim().strip_prefix(TOKEN_PREFIX))?;
    String::from_utf8(hex::decode(hex).ok()?).ok()
}

/// Index of the configured token that matches, compared in constant time.
pub(crate) fn match_token(digests: &[[u8; 32]], presented: &str) -> Option<usize> {
    let presented: [u8; 32] = Sha256::digest(presented.as_bytes()).into();
    let mut found = None;
    for (index, digest) in digests.iter().enumerate() {
        if bool::from(digest.ct_eq(&presented)) {
            found = Some(index);
        }
    }
    found
}

pub(crate) async fn handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<Params>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(token) =
        offered_token(&headers).and_then(|presented| match_token(&state.token_digests, &presented))
    else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !state.config.allowed_ports.contains(&params.port) {
        return (StatusCode::FORBIDDEN, "port not allowed").into_response();
    }
    let Some(permits) = state.permits.get(token) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(permit) = Arc::clone(permits).try_acquire_owned() else {
        return (StatusCode::TOO_MANY_REQUESTS, "too many connections").into_response();
    };
    let addrs = match resolve(
        &params.host,
        params.port,
        state.config.allow_private_targets,
    )
    .await
    {
        Ok(addrs) => addrs,
        Err(rejection) => return rejection.into_response(),
    };
    let Ok(Ok(tcp)) = timeout(CONNECT_TIMEOUT, tokio_happy_eyeballs::connect(&addrs[..])).await
    else {
        return (StatusCode::BAD_GATEWAY, "could not connect").into_response();
    };
    let idle = state.config.idle_timeout;
    upgrade
        .protocols([PROTOCOL])
        .max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            let open = metrics::gauge!("mailbowox_relay_connections");
            open.increment(1);
            let (up, down) = pipe(socket, tcp, idle).await;
            open.decrement(1);
            info!(up, down, "relay closed");
        })
}

/// Browsers hide why a WebSocket upgrade was refused, so the web app posts the code here to learn
/// whether it is good. The body is plain text, which needs no CORS preflight.
pub(crate) async fn check(State(state): State<Arc<AppState>>, code: String) -> StatusCode {
    match match_token(&state.token_digests, &code) {
        Some(_) => StatusCode::NO_CONTENT,
        None => StatusCode::UNAUTHORIZED,
    }
}

pub(crate) async fn resolve(
    host: &str,
    port: u16,
    allow_private: bool,
) -> Result<Vec<SocketAddr>, (StatusCode, &'static str)> {
    let addrs: Vec<SocketAddr> = lookup_host((host.trim_matches(['[', ']']), port))
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "could not resolve host"))?
        .collect();
    if addrs.is_empty() {
        return Err((StatusCode::BAD_GATEWAY, "could not resolve host"));
    }
    // One internal address is enough to refuse: the host could be rebinding.
    if !allow_private && !addrs.iter().all(|addr| is_public(addr.ip())) {
        return Err((StatusCode::FORBIDDEN, "target not allowed"));
    }
    Ok(addrs)
}

/// Whether the address is globally routable: not loopback, private, link-local, shared (CGNAT),
/// reserved, documentation or multicast. An IPv4-mapped IPv6 address counts as its IPv4 one.
pub(crate) fn is_public(ip: IpAddr) -> bool {
    let ip = ip.to_canonical();
    ip_rfc::global(&ip) && !ip.is_multicast()
}

/// Copies both ways until a side closes or goes idle; returns bytes sent up and down.
async fn pipe(mut ws: WebSocket, mut tcp: TcpStream, idle: Duration) -> (u64, u64) {
    let (mut up, mut down) = (0, 0);
    let mut buf = vec![0; 16 * 1024];
    loop {
        tokio::select! {
            message = ws.recv() => match message {
                Some(Ok(Message::Binary(data))) => {
                    if !matches!(timeout(WRITE_TIMEOUT, tcp.write_all(&data)).await, Ok(Ok(()))) {
                        break;
                    }
                    up += data.len() as u64;
                }
                Some(Ok(Message::Text(_))) => {
                    let frame = CloseFrame { code: close_code::UNSUPPORTED, reason: "binary frames only".into() };
                    let _ = ws.send(Message::Close(Some(frame))).await;
                    break;
                }
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
            },
            read = tcp.read(&mut buf) => match read {
                Ok(0) | Err(_) => {
                    let _ = ws.send(Message::Close(None)).await;
                    break;
                }
                Ok(n) => {
                    let frame = Message::Binary(buf.get(..n).unwrap_or(&buf).to_vec().into());
                    if !matches!(timeout(WRITE_TIMEOUT, ws.send(frame)).await, Ok(Ok(()))) {
                        break;
                    }
                    down += n as u64;
                }
            },
            () = sleep(idle) => {
                debug!("relay idle");
                break;
            }
        }
    }
    (up, down)
}

#[cfg(test)]
mod tests {
    use super::is_public;

    #[test]
    fn only_globally_routable_addresses_are_public() {
        for internal in [
            "127.0.0.1",
            "10.1.2.3",
            "169.254.169.254",
            "100.64.0.1",
            "192.0.0.8",
            "198.18.0.1",
            "224.0.0.1",
            "240.0.0.1",
            "0.0.0.0",
            "::1",
            "fd00::1",
            "fe80::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
        ] {
            assert!(!is_public(internal.parse().unwrap()), "{internal}");
        }
        for public in ["1.1.1.1", "2606:4700:4700::1111", "::ffff:1.1.1.1"] {
            assert!(is_public(public.parse().unwrap()), "{public}");
        }
    }
}
