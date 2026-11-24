use std::{future::Future, io, time::Duration};

use tokio::net::{TcpStream, lookup_host};

use super::AddrFilter;
use crate::error::CoreError;

pub(crate) type Pipe = TcpStream;

#[expect(
    clippy::unnecessary_wraps,
    reason = "native builds connect directly; the signature matches the web relay's"
)]
pub(crate) fn configure_relay(_url: &str, _token: String) -> Result<(), CoreError> {
    Ok(())
}

pub(crate) async fn connect(
    host: &str,
    port: u16,
    allowed: Option<AddrFilter>,
) -> io::Result<Pipe> {
    let addrs: Vec<_> = lookup_host((host, port)).await?.collect();
    if let Some(allowed) = allowed
        && !addrs.iter().all(|addr| allowed(addr.ip()))
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "the server's address is not allowed",
        ));
    }
    let stream = tokio_happy_eyeballs::connect(&addrs[..]).await?;
    stream.set_nodelay(true)?;
    Ok(stream)
}

/// Runs `future` for at most `duration`; `None` when it ran out of time.
pub(crate) async fn timeout<T>(duration: Duration, future: impl Future<Output = T>) -> Option<T> {
    tokio::time::timeout(duration, future).await.ok()
}

pub(crate) async fn sleep(duration: Duration) {
    tokio::time::sleep(duration).await;
}
