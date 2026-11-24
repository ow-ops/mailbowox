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

/// Whether the address is globally routable: not loopback, private,
/// link-local, shared (CGNAT), reserved, documentation or multicast. An
/// IPv4-mapped IPv6 address counts as its IPv4 one.
#[must_use]
pub fn is_public(ip: IpAddr) -> bool {
    let ip = ip.to_canonical();
    ip_rfc::global(&ip) && !ip.is_multicast()
}

/// The bytes a read of `n` put in `buf`.
pub(crate) fn filled(buf: &[u8], n: usize) -> &[u8] {
    buf.get(..n).unwrap_or(buf)
}

/// Says whether a connection may go to this address. A host is refused when
/// any of its addresses is, and the connection goes to the addresses that
/// were checked. The web relay applies its own rules instead.
pub type AddrFilter = fn(IpAddr) -> bool;

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
