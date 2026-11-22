//! Byte pipes the protocols run over.
//!
//! Native: plain tokio TCP. wasm32: each pipe is tunnelled through the
//! gateway WebSocket `/relay`. TLS stays in [`crate::tls`] either way, so the
//! relay only sees ciphertext.

use std::net::IpAddr;

#[cfg(not(target_arch = "wasm32"))]
mod tcp;

#[cfg(not(target_arch = "wasm32"))]
pub use tcp::{Pipe, configure_relay, connect, sleep, timeout};

#[cfg(target_arch = "wasm32")]
mod relay;

#[cfg(target_arch = "wasm32")]
pub use relay::{Pipe, configure_relay, connect, sleep, timeout};

pub const READ_CHUNK: usize = 16 * 1024;

/// Says whether a connection may go to this address. A host is refused when
/// any of its addresses is, and the connection goes to the addresses that
/// were checked. The web relay applies its own rules instead.
pub type AddrFilter = fn(IpAddr) -> bool;
