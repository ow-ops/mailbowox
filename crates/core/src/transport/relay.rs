use std::{
    future::{Future, poll_fn},
    io,
    pin::pin,
    sync::{PoisonError, RwLock},
    time::Duration,
};

use futures_util::{
    AsyncReadExt, AsyncWriteExt, SinkExt,
    future::{Either, select},
};
use gloo_net::websocket::{State, futures::WebSocket};
use url::Url;

use super::{AddrFilter, Pipe};
use crate::error::CoreError;

struct Relay {
    url: Url,
    token: String,
}

static RELAY: RwLock<Option<Relay>> = RwLock::new(None);

pub fn configure_relay(url: &str, token: String) -> Result<(), CoreError> {
    let mut url = Url::parse(url).map_err(CoreError::invalid)?;
    let scheme = match url.scheme() {
        "https" => "wss",
        "http" => "ws",
        other => {
            return Err(CoreError::invalid(format!(
                "the gateway URL cannot use {other}:"
            )));
        }
    };
    url.set_scheme(scheme)
        .map_err(|()| CoreError::invalid("bad gateway URL"))?;
    url.path_segments_mut()
        .map_err(|()| CoreError::invalid("bad gateway URL"))?
        .pop_if_empty()
        .push("relay");
    *RELAY.write().unwrap_or_else(PoisonError::into_inner) = Some(Relay { url, token });
    Ok(())
}

pub struct RelayPipe(WebSocket);

pub async fn connect(host: &str, port: u16, _allowed: Option<AddrFilter>) -> io::Result<RelayPipe> {
    let (url, protocols) = {
        let relay = RELAY.read().unwrap_or_else(PoisonError::into_inner);
        let Some(relay) = relay.as_ref() else {
            return Err(io::Error::new(
                io::ErrorKind::NotConnected,
                "no web relay is configured",
            ));
        };
        let mut url = relay.url.clone();
        url.query_pairs_mut()
            .append_pair("host", host)
            .append_pair("port", &port.to_string());
        // Browsers cannot set headers on a WebSocket, and a URL ends up in proxy logs, so the
        // token goes in a subprotocol, hex-encoded as protocol names are limited to token characters.
        let token = format!("token-{}", hex::encode(&relay.token));
        (url, ["mailbowox-relay".to_owned(), token])
    };

    let mut socket = WebSocket::open_with_protocols(url.as_str(), &protocols)
        .map_err(|err| io::Error::other(err.to_string()))?;
    poll_fn(|cx| socket.poll_ready_unpin(cx))
        .await
        .map_err(io::Error::other)?;
    // A refused upgrade (bad token, blocked target) reaches the browser as a bare close, with no status.
    if !matches!(socket.state(), State::Open) {
        return Err(io::Error::new(
            io::ErrorKind::ConnectionRefused,
            format!("the web relay refused {host}:{port}"),
        ));
    }
    Ok(RelayPipe(socket))
}

/// Runs `future` for at most `duration`; `None` when it ran out of time.
pub async fn timeout<T>(duration: Duration, future: impl Future<Output = T>) -> Option<T> {
    match select(pin!(future), gloo_timers::future::sleep(duration)).await {
        Either::Left((value, _)) => Some(value),
        Either::Right(_) => None,
    }
}

pub async fn sleep(duration: Duration) {
    gloo_timers::future::sleep(duration).await;
}

impl Pipe for RelayPipe {
    async fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.0.read(buf).await
    }

    async fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.0.write_all(bytes).await
    }

    async fn close(&mut self) -> io::Result<()> {
        AsyncWriteExt::close(&mut self.0).await
    }
}
