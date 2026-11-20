//! rustls in sans-I/O mode on top of any [`Pipe`], so the same code runs over
//! a TCP socket or the web relay.

use std::{
    future::Future,
    io::{self, Read, Write},
    sync::{Arc, OnceLock},
    time::Duration,
};

use rustls::{ClientConfig, ClientConnection, RootCertStore, pki_types::ServerName};

use crate::{
    error::{CoreError, TlsFailure},
    transport::{self, AddrFilter, DefaultPipe, Pipe},
};

// A server that accepts the connection but never speaks, such as a TLS-only port reached in plain text,
// would otherwise keep the user waiting forever.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub const GREETING_TIMEOUT: Duration = Duration::from_secs(15);
// Applies to each read and each written chunk, not to a whole exchange, so large messages only fail on a
// connection that stalls.
pub const ANSWER_TIMEOUT: Duration = Duration::from_secs(60);
const WRITE_CHUNK: usize = 64 * 1024;

fn client_config() -> Arc<ClientConfig> {
    static CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let roots = RootCertStore {
                roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
            };
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            let config = ClientConfig::builder_with_provider(provider)
                .with_safe_default_protocol_versions()
                .expect("ring supports the default protocol versions")
                .with_root_certificates(roots)
                .with_no_client_auth();
            Arc::new(config)
        })
        .clone()
}

/// A pipe that is either still in plaintext or carries a TLS session.
pub struct SecureStream {
    pipe: DefaultPipe,
    tls: Option<Box<ClientConnection>>,
    chunk: Box<[u8]>,
}

impl SecureStream {
    pub async fn connect(
        host: &str,
        port: u16,
        tls: bool,
        allowed: Option<AddrFilter>,
    ) -> Result<Self, CoreError> {
        within(CONNECT_TIMEOUT, async {
            let mut stream = Self {
                pipe: transport::connect(host, port, allowed).await?,
                tls: None,
                chunk: vec![0; transport::READ_CHUNK].into_boxed_slice(),
            };
            if tls {
                stream.handshake(host).await?;
            }
            Ok(stream)
        })
        .await
    }

    /// Wraps the pipe in TLS and completes the handshake, for implicit TLS and
    /// STARTTLS alike.
    pub async fn start_tls(&mut self, host: &str) -> Result<(), CoreError> {
        within(CONNECT_TIMEOUT, self.handshake(host)).await
    }

    async fn handshake(&mut self, host: &str) -> Result<(), CoreError> {
        if self.tls.is_some() {
            return Err(CoreError::invalid("TLS is already active"));
        }
        let name = ServerName::try_from(host.to_owned()).map_err(CoreError::invalid)?;
        let conn = ClientConnection::new(client_config(), name)?;
        let tls = self.tls.insert(Box::new(conn));

        while tls.is_handshaking() {
            flush(&mut self.pipe, tls).await?;
            if tls.wants_read() {
                let n = self.pipe.read(&mut self.chunk).await?;
                if n == 0 {
                    return Err(CoreError::tls(
                        TlsFailure::Other,
                        "connection closed during the handshake",
                    ));
                }
                tls.read_tls(&mut &self.chunk[..n])?;
                tls.process_new_packets()?;
            }
        }
        flush(&mut self.pipe, tls).await
    }

    /// Like [`Self::read`], failing as a network error when nothing arrives within `limit`.
    pub async fn read_within(
        &mut self,
        buf: &mut [u8],
        limit: Duration,
    ) -> Result<usize, CoreError> {
        within(limit, self.read(buf)).await
    }

    /// Like [`Self::read_within`], for protocols where the server never just
    /// hangs up: a closed connection is a network error.
    pub async fn read_some(&mut self, buf: &mut [u8], limit: Duration) -> Result<usize, CoreError> {
        match self.read_within(buf, limit).await? {
            0 => Err(CoreError::closed()),
            n => Ok(n),
        }
    }

    /// Reads decrypted bytes; `Ok(0)` means the peer closed.
    ///
    /// Cancel-safe, which the IDLE timeout relies on.
    pub async fn read(&mut self, buf: &mut [u8]) -> Result<usize, CoreError> {
        let Some(tls) = self.tls.as_mut() else {
            return Ok(self.pipe.read(buf).await?);
        };

        loop {
            match tls.reader().read(buf) {
                Ok(n) => return Ok(n),
                Err(err) if err.kind() == io::ErrorKind::WouldBlock => {}
                Err(err) => return Err(err.into()),
            }

            let n = self.pipe.read(&mut self.chunk).await?;
            if n == 0 {
                return Ok(0);
            }
            tls.read_tls(&mut &self.chunk[..n])?;
            tls.process_new_packets()?;
            if tls.wants_write() {
                flush(&mut self.pipe, tls).await?;
            }
        }
    }

    pub async fn write_all(&mut self, bytes: &[u8]) -> Result<(), CoreError> {
        match self.tls.as_mut() {
            None => send(&mut self.pipe, bytes).await,
            Some(tls) => {
                tls.writer().write_all(bytes)?;
                flush(&mut self.pipe, tls).await
            }
        }
    }

    pub async fn close(&mut self) -> Result<(), CoreError> {
        if let Some(tls) = self.tls.as_mut() {
            tls.send_close_notify();
            flush(&mut self.pipe, tls).await?;
        }
        Ok(self.pipe.close().await?)
    }
}

async fn flush(pipe: &mut DefaultPipe, tls: &mut ClientConnection) -> Result<(), CoreError> {
    while tls.wants_write() {
        let mut out = Vec::new();
        tls.write_tls(&mut out)?;
        send(pipe, &out).await?;
    }
    Ok(())
}

async fn send(pipe: &mut DefaultPipe, bytes: &[u8]) -> Result<(), CoreError> {
    for chunk in bytes.chunks(WRITE_CHUNK) {
        within(ANSWER_TIMEOUT, async { Ok(pipe.write_all(chunk).await?) }).await?;
    }
    Ok(())
}

async fn within<T>(
    limit: Duration,
    future: impl Future<Output = Result<T, CoreError>>,
) -> Result<T, CoreError> {
    transport::timeout(limit, future).await.unwrap_or_else(|| {
        Err(CoreError::Network {
            message: format!("the server did not answer within {} s", limit.as_secs()),
        })
    })
}

#[cfg(test)]
mod tests {
    use std::{net::Ipv4Addr, time::Duration};

    use tokio::{io::AsyncReadExt, net::TcpListener};
    use web_time::Instant;

    use super::{GREETING_TIMEOUT, SecureStream};
    use crate::{
        error::CoreError,
        imap::ImapConn,
        smtp::SmtpConn,
        types::{Security, ServerConfig},
    };

    /// Accepts connections and reads whatever comes without ever answering, as an implicit TLS port does
    /// with a client that waits for a plain-text greeting.
    async fn silent_server(security: Security) -> ServerConfig {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind");
        let port = listener.local_addr().expect("address").port();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut sink = [0; 1024];
                    while matches!(socket.read(&mut sink).await, Ok(n) if n > 0) {}
                });
            }
        });
        ServerConfig {
            host: "localhost".to_owned(),
            port,
            security,
        }
    }

    fn assert_timed_out(result: &Result<(), CoreError>, started: Instant) {
        let elapsed = started.elapsed();
        assert!(
            matches!(result, Err(CoreError::Network { message }) if message.contains("did not answer")),
            "{result:?}"
        );
        assert!(
            elapsed >= GREETING_TIMEOUT && elapsed < GREETING_TIMEOUT + Duration::from_secs(5),
            "{elapsed:?}"
        );
    }

    #[tokio::test]
    async fn imap_in_plain_text_to_a_tls_only_port_gives_up_as_unreachable() {
        let server = silent_server(Security::Plain).await;
        let started = Instant::now();
        assert_timed_out(&ImapConn::greet(&server).await, started);
    }

    #[tokio::test]
    async fn smtp_starttls_to_a_tls_only_port_gives_up_as_unreachable() {
        let server = silent_server(Security::StartTls).await;
        let started = Instant::now();
        assert_timed_out(&SmtpConn::greet(&server).await, started);
    }

    #[tokio::test]
    async fn a_tls_handshake_the_server_never_answers_gives_up_as_unreachable() {
        let server = silent_server(Security::Tls).await;
        let started = Instant::now();
        assert_timed_out(&ImapConn::greet(&server).await, started);
    }

    #[tokio::test]
    async fn implicit_tls_reaches_the_imap_greeting() {
        let Ok(mut stream) = SecureStream::connect("imap.migadu.com", 993, true, None).await else {
            eprintln!("skipped: imap.migadu.com:993 is unreachable");
            return;
        };
        let mut buf = [0; 512];
        let n = stream.read(&mut buf).await.expect("greeting");
        assert!(
            buf[..n].starts_with(b"* OK"),
            "{:?}",
            String::from_utf8_lossy(&buf[..n])
        );
        stream.close().await.expect("close");
    }
}
