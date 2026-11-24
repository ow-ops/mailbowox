//! Message submission: io-smtp coroutines pumped over a [`SecureStream`].

use std::{borrow::Cow, fmt::Display, net::Ipv4Addr};

use io_sasl::rfc4616::plain::SaslPlainCreds;
use io_smtp::{
    coroutine::{SmtpCoroutine, SmtpCoroutineState, SmtpYield},
    message::{SmtpMessageSend, SmtpMessageSendOptions},
    rfc3207::starttls::SmtpStartTlsError,
    rfc4954::capability::SmtpAuthCapability,
    rfc5321::{SmtpEhloDomain, SmtpForwardPath, SmtpMailbox, SmtpReversePath, quit::SmtpQuit},
    sasl::{
        auth_login::{LOGIN, SmtpAuthLogin, SmtpAuthLoginOptions},
        auth_plain::{PLAIN, SmtpAuthPlain, SmtpAuthPlainOptions},
    },
    session::{
        SmtpSessionOpen, SmtpSessionOpenError, SmtpSessionOpenOptions, SmtpSessionOpenYield,
        SmtpSessionTransport,
    },
};
use secrecy::SecretString;

use crate::{
    error::{CoreError, TlsFailure},
    tls::{ANSWER_TIMEOUT, GREETING_TIMEOUT, SecureStream},
    transport,
    types::{Credentials, Security, ServerConfig},
};

pub(crate) struct SmtpConn {
    stream: SecureStream,
    buf: Box<[u8]>,
    /// The last write ended a message with its final dot.
    handed_over: bool,
}

impl SmtpConn {
    pub(crate) async fn open(
        server: &ServerConfig,
        credentials: &Credentials,
    ) -> Result<Self, CoreError> {
        let (mut conn, capabilities) = Self::connect(server).await?;
        conn.authenticate(&capabilities, credentials).await?;
        Ok(conn)
    }

    /// Reaches EHLO, through STARTTLS when the server is set up for it, without logging in.
    pub(crate) async fn greet(server: &ServerConfig) -> Result<(), CoreError> {
        Self::connect(server).await?.0.quit().await
    }

    async fn connect(server: &ServerConfig) -> Result<(Self, Vec<Cow<'static, str>>), CoreError> {
        let (host, port) = (server.host.clone(), server.port);
        let transport = match server.security {
            Security::Tls => SmtpSessionTransport::Tls { host, port },
            Security::StartTls | Security::Plain => SmtpSessionTransport::Tcp { host, port },
        };
        let opts = SmtpSessionOpenOptions {
            starttls: server.security == Security::StartTls,
            ..Default::default()
        };
        let mut session =
            SmtpSessionOpen::new(transport, ehlo_domain(), None::<SaslPlainCreds>, opts);
        let mut buf = vec![0; transport::READ_CHUNK].into_boxed_slice();
        let mut stream: Option<SecureStream> = None;
        let mut arg: Option<&[u8]> = None;

        let opened = loop {
            match session.resume(arg.take()) {
                SmtpCoroutineState::Complete(Ok(opened)) => break opened,
                SmtpCoroutineState::Complete(Err(err)) => return Err(open_error(err)),
                SmtpCoroutineState::Yielded(yielded) => match yielded {
                    SmtpSessionOpenYield::WantsTcpConnect { host, port } => {
                        stream = Some(SecureStream::connect(&host, port, false, None).await?);
                    }
                    SmtpSessionOpenYield::WantsTlsConnect { host, port } => {
                        stream = Some(SecureStream::connect(&host, port, true, None).await?);
                    }
                    SmtpSessionOpenYield::WantsUnixConnect(_) => {
                        return Err(CoreError::invalid("unix sockets are not supported"));
                    }
                    SmtpSessionOpenYield::WantsTlsUpgrade => {
                        connected(&mut stream)?.start_tls(&server.host).await?;
                    }
                    SmtpSessionOpenYield::WantsWrite(bytes) => {
                        connected(&mut stream)?.write_all(&bytes).await?;
                    }
                    SmtpSessionOpenYield::WantsRead => {
                        let n = connected(&mut stream)?
                            .read_some(&mut buf, GREETING_TIMEOUT)
                            .await?;
                        arg = Some(transport::filled(&buf, n));
                    }
                },
            }
        };

        let conn = Self {
            stream: stream.ok_or_else(|| CoreError::protocol("SMTP session never connected"))?,
            buf,
            handed_over: false,
        };
        Ok((conn, opened.capabilities))
    }

    /// AUTH PLAIN, or AUTH LOGIN for servers that only offer that.
    async fn authenticate(
        &mut self,
        capabilities: &[Cow<'_, str>],
        credentials: &Credentials,
    ) -> Result<(), CoreError> {
        let password = SecretString::from(credentials.password.clone());
        let login_only = capabilities
            .iter()
            .find_map(|line| {
                let line = line.replacen("AUTH=", "AUTH ", 1);
                let auth = SmtpAuthCapability::parse(&line).ok()?;
                Some(!auth.has(PLAIN) && auth.has(LOGIN))
            })
            .unwrap_or(false);

        if login_only {
            let auth = SmtpAuthLogin::new(
                &credentials.username,
                &password,
                ehlo_domain(),
                SmtpAuthLoginOptions::default(),
            );
            self.run(auth).await?.map_err(CoreError::auth)
        } else {
            let auth = SmtpAuthPlain::new(
                None::<&str>,
                &credentials.username,
                &password,
                ehlo_domain(),
                SmtpAuthPlainOptions::default(),
            );
            self.run(auth).await?.map_err(CoreError::auth)
        }
    }

    pub(crate) async fn send(
        &mut self,
        from: &str,
        recipients: &[&str],
        raw: Vec<u8>,
    ) -> Result<(), CoreError> {
        let reverse_path = SmtpReversePath::from(smtp_mailbox(from)?);
        let forward_paths = recipients
            .iter()
            .map(|to| smtp_mailbox(to).map(SmtpForwardPath::from))
            .collect::<Result<Vec<_>, _>>()?;
        let send = SmtpMessageSend::new(
            reverse_path,
            forward_paths,
            raw,
            SmtpMessageSendOptions::default(),
        );
        let outcome = self.exec(send).await;
        // Past the final dot only the server's answer was lost: it may have taken the message.
        outcome.map(drop).map_err(|err| match err {
            CoreError::Network { message } | CoreError::Tls { message, .. } if self.handed_over => {
                CoreError::Unconfirmed { message }
            }
            err => err,
        })
    }

    pub(crate) async fn quit(mut self) -> Result<(), CoreError> {
        self.exec(SmtpQuit::new()).await?;
        self.stream.close().await
    }

    async fn run<C, T, E>(&mut self, mut coroutine: C) -> Result<Result<T, E>, CoreError>
    where
        C: SmtpCoroutine<Yield = SmtpYield, Return = Result<T, E>>,
    {
        let mut arg: Option<&[u8]> = None;
        loop {
            match coroutine.resume(arg.take()) {
                SmtpCoroutineState::Complete(result) => return Ok(result),
                SmtpCoroutineState::Yielded(SmtpYield::WantsWrite(bytes)) => {
                    self.stream.write_all(&bytes).await?;
                    self.handed_over = bytes.ends_with(b"\r\n.\r\n");
                }
                SmtpCoroutineState::Yielded(SmtpYield::WantsRead) => {
                    let n = self.stream.read_some(&mut self.buf, ANSWER_TIMEOUT).await?;
                    arg = Some(transport::filled(&self.buf, n));
                }
            }
        }
    }

    async fn exec<C, T, E>(&mut self, coroutine: C) -> Result<T, CoreError>
    where
        C: SmtpCoroutine<Yield = SmtpYield, Return = Result<T, E>>,
        E: Display,
    {
        self.run(coroutine).await?.map_err(CoreError::protocol)
    }
}

/// Identifies as `[127.0.0.1]` so the device's host name stays private.
fn ehlo_domain() -> SmtpEhloDomain<'static> {
    SmtpEhloDomain::from(Ipv4Addr::LOCALHOST)
}

fn smtp_mailbox(address: &str) -> Result<SmtpMailbox<'_>, CoreError> {
    SmtpMailbox::try_from(address).map_err(|err| CoreError::invalid(format!("{address}: {err}")))
}

fn connected(stream: &mut Option<SecureStream>) -> Result<&mut SecureStream, CoreError> {
    stream
        .as_mut()
        .ok_or_else(|| CoreError::protocol("SMTP session asked for I/O before connecting"))
}

fn open_error(err: SmtpSessionOpenError) -> CoreError {
    match err {
        SmtpSessionOpenError::StartTls(SmtpStartTlsError::Rejected { .. }) => {
            CoreError::tls(TlsFailure::StartTlsRefused, err)
        }
        SmtpSessionOpenError::StartTls(_)
        | SmtpSessionOpenError::StartTlsInjection
        | SmtpSessionOpenError::StartTlsOverTls => CoreError::tls(TlsFailure::Other, err),
        _ => CoreError::protocol(err),
    }
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::TcpListener,
    };

    use super::*;

    /// A submission server that answers every command until the client sends the line starting with
    /// `hang_up_at`, where it drops the connection without a word.
    async fn server_hanging_up_at(hang_up_at: &'static str) -> ServerConfig {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind");
        let port = listener.local_addr().expect("address").port();
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.expect("accept");
            let (read, mut write) = socket.into_split();
            let mut lines = BufReader::new(read).lines();
            write.write_all(b"220 test\r\n").await.expect("greeting");
            let mut in_data = false;
            while let Ok(Some(line)) = lines.next_line().await {
                if line.starts_with(hang_up_at) {
                    return;
                }
                let reply: &[u8] = if in_data {
                    if line != "." {
                        continue;
                    }
                    in_data = false;
                    b"250 queued\r\n"
                } else if line.starts_with("EHLO") {
                    b"250-test\r\n250 AUTH PLAIN\r\n"
                } else if line.starts_with("AUTH") {
                    b"235 ok\r\n"
                } else if line == "DATA" {
                    in_data = true;
                    b"354 go on\r\n"
                } else {
                    b"250 ok\r\n"
                };
                write.write_all(reply).await.expect("reply");
            }
        });
        ServerConfig {
            host: "localhost".to_owned(),
            port,
            security: Security::Plain,
        }
    }

    async fn send_through(server: &ServerConfig) -> Result<(), CoreError> {
        let credentials = Credentials {
            username: "me".to_owned(),
            password: "secret".to_owned(),
        };
        let mut conn = SmtpConn::open(server, &credentials).await?;
        conn.send(
            "me@example.org",
            &["you@example.org"],
            b"Subject: hi\r\n\r\nhello\r\n".to_vec(),
        )
        .await
    }

    #[tokio::test]
    async fn a_connection_lost_after_the_final_dot_leaves_the_message_unconfirmed() {
        let result = send_through(&server_hanging_up_at(".").await).await;
        assert!(
            matches!(result, Err(CoreError::Unconfirmed { .. })),
            "{result:?}"
        );
    }

    #[tokio::test]
    async fn a_connection_lost_before_the_message_went_out_is_a_network_failure() {
        let result = send_through(&server_hanging_up_at("RCPT").await).await;
        assert!(
            matches!(result, Err(CoreError::Network { .. })),
            "{result:?}"
        );
    }

    #[tokio::test]
    async fn a_message_the_server_answers_is_sent() {
        let result = send_through(&server_hanging_up_at("QUIT").await).await;
        assert!(result.is_ok(), "{result:?}");
    }
}
