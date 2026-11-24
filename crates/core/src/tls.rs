//! tokio-rustls on top of a [`Pipe`], so the same code runs over a TCP socket
//! or the web relay.

use std::{
    future::Future,
    io, mem,
    sync::{Arc, OnceLock},
    time::Duration,
};

use rustls::{ClientConfig, RootCertStore, pki_types::ServerName};
use tokio::io::{AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio_rustls::{TlsConnector, client::TlsStream};

use crate::{
    error::{CoreError, TlsFailure},
    transport::{self, AddrFilter, Pipe},
};

// A server that accepts the connection but never speaks, such as a TLS-only port reached in plain text,
// would otherwise keep the user waiting forever.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub(crate) const GREETING_TIMEOUT: Duration = Duration::from_secs(15);
// Applies to each read and each written chunk, not to a whole exchange, so large messages only fail on a
// connection that stalls.
pub(crate) const ANSWER_TIMEOUT: Duration = Duration::from_secs(60);
const WRITE_CHUNK: usize = 64 * 1024;

#[expect(
    clippy::expect_used,
    reason = "ring supports the default protocol versions"
)]
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
pub(crate) struct SecureStream {
    state: State,
}

enum State {
    Plain(Pipe),
    Tls(Box<TlsStream<Pipe>>),
    /// Left by a failed or cancelled handshake.
    Closed,
}

impl SecureStream {
    pub(crate) async fn connect(
        host: &str,
        port: u16,
        tls: bool,
        allowed: Option<AddrFilter>,
    ) -> Result<Self, CoreError> {
        within(CONNECT_TIMEOUT, async {
            let mut stream = Self {
                state: State::Plain(transport::connect(host, port, allowed).await?),
            };
            if tls {
                stream.handshake(host, client_config()).await?;
            }
            Ok(stream)
        })
        .await
    }

    /// Wraps the pipe in TLS and completes the handshake, for implicit TLS and
    /// STARTTLS alike.
    pub(crate) async fn start_tls(&mut self, host: &str) -> Result<(), CoreError> {
        within(CONNECT_TIMEOUT, self.handshake(host, client_config())).await
    }

    async fn handshake(&mut self, host: &str, config: Arc<ClientConfig>) -> Result<(), CoreError> {
        let name = ServerName::try_from(host.to_owned()).map_err(CoreError::invalid)?;
        let pipe = match mem::replace(&mut self.state, State::Closed) {
            State::Plain(pipe) => pipe,
            State::Closed => return Err(CoreError::closed()),
            active @ State::Tls(_) => {
                self.state = active;
                return Err(CoreError::invalid("TLS is already active"));
            }
        };
        let tls = TlsConnector::from(config)
            .connect(name, pipe)
            .await
            .map_err(|err| match err.kind() {
                io::ErrorKind::UnexpectedEof => {
                    CoreError::tls(TlsFailure::Other, "connection closed during the handshake")
                }
                _ => err.into(),
            })?;
        self.state = State::Tls(Box::new(tls));
        Ok(())
    }

    /// Like [`Self::read`], failing as a network error when nothing arrives within `limit`.
    pub(crate) async fn read_within(
        &mut self,
        buf: &mut [u8],
        limit: Duration,
    ) -> Result<usize, CoreError> {
        within(limit, self.read(buf)).await
    }

    /// Like [`Self::read_within`], for protocols where the server never just
    /// hangs up: a closed connection is a network error.
    pub(crate) async fn read_some(
        &mut self,
        buf: &mut [u8],
        limit: Duration,
    ) -> Result<usize, CoreError> {
        match self.read_within(buf, limit).await? {
            0 => Err(CoreError::closed()),
            n => Ok(n),
        }
    }

    /// Reads decrypted bytes; `Ok(0)` means the peer closed cleanly.
    ///
    /// Cancel-safe, which the IDLE timeout relies on.
    pub(crate) async fn read(&mut self, buf: &mut [u8]) -> Result<usize, CoreError> {
        let read = match &mut self.state {
            State::Plain(pipe) => pipe.read(buf).await,
            State::Tls(tls) => match tls.read(buf).await {
                // Without a close_notify the answer may have been truncated.
                Err(err) if err.kind() == io::ErrorKind::UnexpectedEof => {
                    return Err(CoreError::closed());
                }
                read => read,
            },
            State::Closed => return Err(CoreError::closed()),
        };
        Ok(read?)
    }

    pub(crate) async fn write_all(&mut self, bytes: &[u8]) -> Result<(), CoreError> {
        for chunk in bytes.chunks(WRITE_CHUNK) {
            within(ANSWER_TIMEOUT, async {
                match &mut self.state {
                    State::Plain(pipe) => send(pipe, chunk).await,
                    State::Tls(tls) => send(tls, chunk).await,
                    State::Closed => Err(CoreError::closed()),
                }
            })
            .await?;
        }
        Ok(())
    }

    pub(crate) async fn close(&mut self) -> Result<(), CoreError> {
        within(ANSWER_TIMEOUT, async {
            match &mut self.state {
                State::Plain(pipe) => pipe.shutdown().await?,
                State::Tls(tls) => tls.shutdown().await?,
                State::Closed => {}
            }
            Ok(())
        })
        .await
    }
}

// tokio-rustls can report bytes as written before it has sent them.
async fn send(io: &mut (impl AsyncWrite + Unpin), bytes: &[u8]) -> Result<(), CoreError> {
    io.write_all(bytes).await?;
    Ok(io.flush().await?)
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
    use std::{
        io::{self, Read, Write},
        net::{Ipv4Addr, Shutdown, TcpStream},
        sync::Arc,
        thread,
        time::Duration,
    };

    use rustls::{
        ClientConfig, RootCertStore, ServerConfig as TlsServerConfig, ServerConnection,
        StreamOwned, pki_types::PrivateKeyDer,
    };
    use tokio::{io::AsyncReadExt, net::TcpListener};
    use web_time::Instant;

    use super::{GREETING_TIMEOUT, SecureStream};
    use crate::{
        error::{CoreError, TlsFailure},
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

    type Peer = StreamOwned<ServerConnection, TcpStream>;

    const LIMIT: Duration = Duration::from_secs(10);

    /// Upgrades a connection to a local server whose certificate covers `names`.
    async fn connect_to(
        names: Vec<String>,
        serve: impl FnOnce(&mut Peer) -> io::Result<()> + Send + 'static,
    ) -> Result<SecureStream, CoreError> {
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(names).expect("certificate");
        let key = PrivateKeyDer::Pkcs8(signing_key.serialize_der().into());
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let mut roots = RootCertStore::empty();
        roots.add(cert.der().clone()).expect("root");
        let client = ClientConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .expect("client version")
            .with_root_certificates(roots)
            .with_no_client_auth();
        let server = TlsServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .expect("server version")
            .with_no_client_auth()
            .with_single_cert(vec![cert.der().clone()], key)
            .expect("server certificate");

        let port = local_server(move |socket| {
            let conn = ServerConnection::new(Arc::new(server)).expect("server");
            let mut tls = StreamOwned::new(conn, socket);
            // The client asserts on any failure.
            let _ = serve(&mut tls);
            // Closing with the client's bytes unread would reset the connection under the test.
            let _ = io::copy(&mut tls.sock, &mut io::sink());
        });
        let mut stream = SecureStream::connect("localhost", port, false, None).await?;
        tokio::time::timeout(LIMIT, stream.handshake("localhost", Arc::new(client)))
            .await
            .expect("handshake stalled")?;
        Ok(stream)
    }

    fn local_server(serve: impl FnOnce(TcpStream) + Send + 'static) -> u16 {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let port = listener.local_addr().expect("address").port();
        thread::spawn(move || serve(listener.accept().expect("accept").0));
        port
    }

    fn failure<T>(result: &Result<T, CoreError>) -> Option<TlsFailure> {
        match result {
            Err(CoreError::Tls { reason, .. }) => Some(*reason),
            _ => None,
        }
    }

    fn localhost() -> Vec<String> {
        vec!["localhost".to_owned()]
    }

    fn payload(len: usize) -> Vec<u8> {
        (0..=250).cycle().take(len).collect()
    }

    async fn read_to_end(stream: &mut SecureStream) -> Vec<u8> {
        let mut received = Vec::new();
        let mut buf = [0; 8 * 1024];
        loop {
            match stream.read_within(&mut buf, LIMIT).await.expect("read") {
                0 => return received,
                n => received.extend_from_slice(&buf[..n]),
            }
        }
    }

    async fn assert_downloads_intact(names: Vec<String>) {
        let sent = payload(256 * 1024);
        let body = sent.clone();
        let mut stream = connect_to(names, move |tls| {
            tls.write_all(&body)?;
            tls.conn.send_close_notify();
            tls.flush()
        })
        .await
        .expect("connect");
        let received = read_to_end(&mut stream).await;
        assert!(received == sent, "got {} bytes", received.len());
    }

    #[tokio::test]
    async fn a_large_download_arrives_intact() {
        assert_downloads_intact(localhost()).await;
    }

    #[tokio::test]
    async fn a_handshake_larger_than_one_rustls_read_completes() {
        let mut names = localhost();
        names.extend((0..600).map(|i| format!("host-{i}.mailbowox.test")));
        assert_downloads_intact(names).await;
    }

    #[tokio::test]
    async fn a_large_upload_arrives_intact() {
        let sent = payload(4 * 1024 * 1024);
        let expected = sent.clone();
        let mut stream = connect_to(localhost(), move |tls| {
            let mut received = vec![0; expected.len()];
            tls.read_exact(&mut received)?;
            tls.write_all(if received == expected { b"=" } else { b"!" })?;
            tls.flush()
        })
        .await
        .expect("connect");
        stream.write_all(&sent).await.expect("write");
        let mut answer = [0];
        stream.read_some(&mut answer, LIMIT).await.expect("answer");
        assert_eq!(&answer, b"=");
    }

    #[tokio::test]
    async fn a_read_that_timed_out_loses_nothing() {
        let mut stream = connect_to(localhost(), |tls| {
            tls.conn.complete_io(&mut tls.sock)?;
            thread::sleep(Duration::from_millis(300));
            tls.write_all(b"* 1 EXISTS")?;
            tls.conn.send_close_notify();
            tls.flush()
        })
        .await
        .expect("connect");
        let early = stream
            .read_within(&mut [0; 64], Duration::from_millis(20))
            .await;
        assert!(early.is_err(), "{early:?}");
        assert_eq!(read_to_end(&mut stream).await, b"* 1 EXISTS");
    }

    #[tokio::test]
    async fn a_close_without_close_notify_is_an_error() {
        let mut stream = connect_to(localhost(), |tls| {
            tls.write_all(b"body")?;
            tls.flush()?;
            tls.sock.shutdown(Shutdown::Write)
        })
        .await
        .expect("connect");
        let mut buf = [0; 4];
        let n = stream.read_some(&mut buf, LIMIT).await.expect("body");
        assert_eq!(&buf[..n], b"body");
        let end = stream.read_within(&mut buf, LIMIT).await;
        assert!(
            matches!(&end, Err(CoreError::Network { message }) if message == "the server closed the connection"),
            "{end:?}"
        );
    }

    #[tokio::test]
    async fn a_certificate_for_another_name_is_reported() {
        let result = connect_to(vec!["elsewhere.test".to_owned()], Write::flush).await;
        assert_eq!(failure(&result), Some(TlsFailure::Certificate));
    }

    #[tokio::test]
    async fn a_plain_text_answer_to_the_handshake_is_reported_as_not_tls() {
        let port = local_server(|mut socket| {
            let _ = socket.write_all(b"* OK IMAP ready\r\n");
            let _ = io::copy(&mut socket, &mut io::sink());
        });
        let result = SecureStream::connect("localhost", port, true, None).await;
        assert_eq!(failure(&result), Some(TlsFailure::NotTls));
    }

    #[tokio::test]
    async fn a_close_during_the_handshake_is_a_tls_failure() {
        let port = local_server(|mut socket| {
            let _ = socket.read(&mut [0; 4096]);
            let _ = socket.shutdown(Shutdown::Write);
            let _ = io::copy(&mut socket, &mut io::sink());
        });
        let result = SecureStream::connect("localhost", port, true, None).await;
        assert_eq!(failure(&result), Some(TlsFailure::Other));
    }
}
