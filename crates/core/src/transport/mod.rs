//! Byte pipes the protocols run over.
//!
//! Native: plain tokio TCP. wasm32: each pipe is tunnelled through the
//! gateway WebSocket `/relay`. TLS stays in [`crate::tls`] either way, so the
//! relay only sees ciphertext.

use std::{future::Future, io, net::IpAddr};

#[cfg(not(target_arch = "wasm32"))]
mod tcp;

#[cfg(not(target_arch = "wasm32"))]
pub use tcp::{TcpPipe as DefaultPipe, configure_relay, connect, sleep, timeout};

#[cfg(target_arch = "wasm32")]
mod relay;

#[cfg(target_arch = "wasm32")]
pub use relay::{RelayPipe as DefaultPipe, configure_relay, connect, sleep, timeout};

pub const READ_CHUNK: usize = 16 * 1024;

/// Says whether a connection may go to this address. A host is refused when
/// any of its addresses is, and the connection goes to the addresses that
/// were checked. The web relay applies its own rules instead.
pub type AddrFilter = fn(IpAddr) -> bool;

pub trait Pipe {
    /// Reads at most `buf.len()` bytes; `Ok(0)` means the peer closed.
    fn read(&mut self, buf: &mut [u8]) -> impl Future<Output = io::Result<usize>>;
    fn write_all(&mut self, bytes: &[u8]) -> impl Future<Output = io::Result<()>>;
    fn close(&mut self) -> impl Future<Output = io::Result<()>>;
}
