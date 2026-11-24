//! Byte pipes the protocols run over.
//!
//! Native: plain tokio TCP. wasm32: each pipe is tunnelled through the
//! gateway WebSocket `/relay`. TLS stays in [`crate::tls`] either way, so the
//! relay only sees ciphertext.

use std::net::IpAddr;

#[cfg(not(target_arch = "wasm32"))]
mod tcp;

#[cfg(not(target_arch = "wasm32"))]
pub(crate) use tcp::{Pipe, configure_relay, connect, sleep, timeout};

#[cfg(target_arch = "wasm32")]
mod relay;

#[cfg(target_arch = "wasm32")]
pub(crate) use relay::{Pipe, configure_relay, connect, sleep, timeout};

pub(crate) const READ_CHUNK: usize = 16 * 1024;

/// The bytes a read of `n` put in `buf`.
pub(crate) fn filled(buf: &[u8], n: usize) -> &[u8] {
    buf.get(..n).unwrap_or(buf)
}

/// Says whether a connection may go to this address. A host is refused when
/// any of its addresses is, and the connection goes to the addresses that
/// were checked. The web relay applies its own rules instead.
pub type AddrFilter = fn(IpAddr) -> bool;
