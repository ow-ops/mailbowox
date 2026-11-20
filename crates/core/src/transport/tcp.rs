use std::{future::Future, io, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpStream, lookup_host},
};

use super::{AddrFilter, Pipe};
use crate::error::CoreError;

pub struct TcpPipe(TcpStream);

#[allow(
    clippy::unnecessary_wraps,
    reason = "native builds connect directly; the signature matches the web relay's"
)]
pub fn configure_relay(_url: &str, _token: String) -> Result<(), CoreError> {
    Ok(())
}

pub async fn connect(host: &str, port: u16, allowed: Option<AddrFilter>) -> io::Result<TcpPipe> {
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
    Ok(TcpPipe(stream))
}

/// Runs `future` for at most `duration`; `None` when it ran out of time.
pub async fn timeout<T>(duration: Duration, future: impl Future<Output = T>) -> Option<T> {
    tokio::time::timeout(duration, future).await.ok()
}

pub async fn sleep(duration: Duration) {
    tokio::time::sleep(duration).await;
}

impl Pipe for TcpPipe {
    async fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.0.read(buf).await
    }

    async fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.0.write_all(bytes).await
    }

    async fn close(&mut self) -> io::Result<()> {
        self.0.shutdown().await
    }
}
