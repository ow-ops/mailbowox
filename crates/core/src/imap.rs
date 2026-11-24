//! One IMAP connection: opening it, and pumping io-imap coroutines over it.

use std::{
    fmt::Display,
    num::NonZeroU32,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use io_imap::{
    codec::fragmentizer::Fragmentizer,
    coroutine::{ImapCoroutine, ImapCoroutineState, ImapYield},
    has_imap_capability,
    rfc2177::idle::{ImapIdle, ImapIdleOptions, ImapIdleYield},
    rfc3501::{
        logout::ImapLogout,
        select::{
            ImapMailboxSelect, ImapMailboxSelectData, ImapMailboxSelectError,
            ImapMailboxSelectOptions,
        },
        starttls::ImapStartTlsError,
    },
    rfc5161::enable::ImapExtensionEnable,
    session::{
        ImapSessionOpen, ImapSessionOpenError, ImapSessionOpenOptions, ImapSessionOpenYield,
        ImapSessionTransport,
    },
    types::{
        command::SelectParameter,
        core::{Atom, Vec1},
        extensions::enable::CapabilityEnable,
        mailbox::Mailbox,
        response::Capability,
        sequence::{SeqOrUid, Sequence, SequenceSet},
    },
};
use io_sasl::login::SaslLoginCreds;
use web_time::Instant;

use crate::{
    error::{CoreError, TlsFailure},
    tls::{ANSWER_TIMEOUT, GREETING_TIMEOUT, SecureStream},
    transport::{self, AddrFilter},
    types::{Credentials, Security, ServerConfig},
};

const MAX_MESSAGE: u32 = 64 * 1024 * 1024;
const DONE_TIMEOUT: Duration = Duration::from_secs(60);

pub(crate) struct ImapConn {
    stream: SecureStream,
    fragmentizer: Fragmentizer,
    buf: Box<[u8]>,
    tags: u32,
    capabilities: Vec<Capability<'static>>,
    qresync: bool,
    selected: Option<(String, Option<NonZeroU32>)>,
    /// Set while a command runs. One that fails on the wire or is dropped
    /// midway leaves it set: the stream is then out of step with the protocol.
    in_flight: bool,
}

impl ImapConn {
    pub(crate) async fn open(
        server: &ServerConfig,
        credentials: &Credentials,
        allowed: Option<AddrFilter>,
    ) -> Result<Self, CoreError> {
        let sasl = SaslLoginCreds {
            username: credentials.username.clone(),
            password: credentials.password.clone().into(),
        };
        let mut conn = Self::connect(server, Some(sasl), allowed).await?;
        conn.enable_qresync().await?;
        Ok(conn)
    }

    /// Reaches the greeting, through STARTTLS when the server is set up for it, without logging in.
    pub(crate) async fn greet(server: &ServerConfig) -> Result<(), CoreError> {
        Self::connect(server, None, None)
            .await?
            .stream
            .close()
            .await
    }

    async fn connect(
        server: &ServerConfig,
        sasl: Option<SaslLoginCreds>,
        allowed: Option<AddrFilter>,
    ) -> Result<Self, CoreError> {
        let (host, port) = (server.host.clone(), server.port);
        let transport = match server.security {
            Security::Tls => ImapSessionTransport::Tls { host, port },
            Security::StartTls | Security::Plain => ImapSessionTransport::Tcp { host, port },
        };
        let opts = ImapSessionOpenOptions {
            starttls: server.security == Security::StartTls,
            ..Default::default()
        };

        let mut session = ImapSessionOpen::new(transport, sasl, opts);
        let mut fragmentizer = Fragmentizer::new(MAX_MESSAGE);
        let mut buf = vec![0; transport::READ_CHUNK].into_boxed_slice();
        let mut stream: Option<SecureStream> = None;
        let mut tags = 0;
        let mut tag;
        let mut arg: Option<&[u8]> = None;

        let opened = loop {
            match session.resume(&mut fragmentizer, arg.take()) {
                ImapCoroutineState::Complete(Ok(opened)) => break opened,
                ImapCoroutineState::Complete(Err(err)) => return Err(open_error(err)),
                ImapCoroutineState::Yielded(yielded) => match yielded {
                    ImapSessionOpenYield::WantsTcpConnect { host, port } => {
                        stream = Some(SecureStream::connect(&host, port, false, allowed).await?);
                    }
                    ImapSessionOpenYield::WantsTlsConnect { host, port } => {
                        stream = Some(SecureStream::connect(&host, port, true, allowed).await?);
                    }
                    ImapSessionOpenYield::WantsUnixConnect(_) => {
                        return Err(CoreError::invalid("unix sockets are not supported"));
                    }
                    ImapSessionOpenYield::WantsTlsUpgrade => {
                        connected(&mut stream)?.start_tls(&server.host).await?;
                    }
                    ImapSessionOpenYield::WantsTag => {
                        tags += 1;
                        tag = format!("A{tags}");
                        arg = Some(tag.as_bytes());
                    }
                    ImapSessionOpenYield::WantsWrite(bytes) => {
                        connected(&mut stream)?.write_all(&bytes).await?;
                    }
                    ImapSessionOpenYield::WantsRead => {
                        let n = connected(&mut stream)?
                            .read_some(&mut buf, GREETING_TIMEOUT)
                            .await?;
                        arg = Some(transport::filled(&buf, n));
                    }
                },
            }
        };

        Ok(Self {
            stream: stream.ok_or_else(|| CoreError::protocol("IMAP session never connected"))?,
            fragmentizer,
            buf,
            tags,
            capabilities: opened.capability,
            qresync: false,
            selected: None,
            in_flight: false,
        })
    }

    pub(crate) fn has(&self, capability: &Capability<'_>) -> bool {
        self.capabilities.iter().any(|c| c == capability)
    }

    pub(crate) fn imap4rev2(&self) -> bool {
        self.capabilities
            .iter()
            .any(|c| c.to_string().eq_ignore_ascii_case("IMAP4rev2"))
    }

    pub(crate) const fn qresync(&self) -> bool {
        self.qresync
    }

    /// The connection can no longer be trusted to answer the next command.
    pub(crate) const fn broken(&self) -> bool {
        self.in_flight
    }

    pub(crate) fn condstore(&self) -> bool {
        has_imap_capability!(self.capabilities, CondStore) || self.qresync
    }

    async fn enable_qresync(&mut self) -> Result<(), CoreError> {
        if !has_imap_capability!(self.capabilities, QResync) {
            return Ok(());
        }
        // QRESYNC is not in the typed enum, so it travels as an atom.
        let qresync = Atom::try_from("QRESYNC").map_err(CoreError::protocol)?;
        let capabilities = Vec1::try_from(vec![CapabilityEnable::CondStore, qresync.into()])
            .map_err(CoreError::protocol)?;
        let enabled = self.exec(ImapExtensionEnable::new(capabilities)).await?;
        self.qresync = enabled
            .iter()
            .flatten()
            .any(|c| c.to_string().eq_ignore_ascii_case("QRESYNC"));
        Ok(())
    }

    /// Runs a command coroutine, leaving its own error for the caller to map.
    pub(crate) async fn run<C, T, E>(&mut self, mut coroutine: C) -> Result<Result<T, E>, CoreError>
    where
        C: ImapCoroutine<Yield = ImapYield, Return = Result<T, E>>,
    {
        let Self {
            stream,
            fragmentizer,
            buf,
            tags,
            in_flight,
            ..
        } = self;
        let mut tag;
        let mut arg: Option<&[u8]> = None;
        *in_flight = true;

        loop {
            match coroutine.resume(fragmentizer, arg.take()) {
                ImapCoroutineState::Complete(result) => {
                    *in_flight = false;
                    return Ok(result);
                }
                ImapCoroutineState::Yielded(ImapYield::WantsTag) => {
                    *tags += 1;
                    tag = format!("A{tags}");
                    arg = Some(tag.as_bytes());
                }
                ImapCoroutineState::Yielded(ImapYield::WantsWrite(bytes)) => {
                    stream.write_all(&bytes).await?;
                }
                ImapCoroutineState::Yielded(ImapYield::WantsRead) => {
                    let n = stream.read_some(buf, ANSWER_TIMEOUT).await?;
                    arg = Some(transport::filled(buf, n));
                }
            }
        }
    }

    /// Runs a command coroutine, reporting its failure as a protocol error.
    pub(crate) async fn exec<C, T, E>(&mut self, coroutine: C) -> Result<T, CoreError>
    where
        C: ImapCoroutine<Yield = ImapYield, Return = Result<T, E>>,
        E: Display,
    {
        self.run(coroutine).await?.map_err(CoreError::protocol)
    }

    pub(crate) async fn select(
        &mut self,
        mailbox: &str,
        parameters: Vec<SelectParameter>,
    ) -> Result<ImapMailboxSelectData, CoreError> {
        self.selected = None;
        let opts = ImapMailboxSelectOptions { parameters };
        let data = match self
            .run(ImapMailboxSelect::new(mailbox_name(mailbox)?, opts))
            .await?
        {
            Ok(out) => out.data,
            Err(ImapMailboxSelectError::No(status)) => {
                return Err(CoreError::not_found(status.text));
            }
            Err(err) => return Err(CoreError::protocol(err)),
        };
        self.selected = Some((mailbox.to_owned(), data.uid_validity));
        Ok(data)
    }

    pub(crate) async fn selected_uid_validity(&mut self, mailbox: &str) -> Result<u32, CoreError> {
        let uid_validity = match &self.selected {
            Some((name, uid_validity)) if name == mailbox => *uid_validity,
            _ => self.select(mailbox, Vec::new()).await?.uid_validity,
        };
        uid_validity
            .map(NonZeroU32::get)
            .ok_or_else(|| CoreError::protocol("the server omitted UIDVALIDITY"))
    }

    pub(crate) async fn ensure_selected(
        &mut self,
        mailbox: &str,
        uid_validity: u32,
    ) -> Result<(), CoreError> {
        if self.selected_uid_validity(mailbox).await? != uid_validity {
            return Err(CoreError::not_found(
                "the mailbox changed; reopen the message after syncing",
            ));
        }
        Ok(())
    }

    /// Idles on the selected mailbox until the server reports a change or
    /// `duration` runs out; true on a change.
    pub(crate) async fn idle(&mut self, duration: Duration) -> Result<bool, CoreError> {
        let done = Arc::new(AtomicBool::new(false));
        let mut idle = ImapIdle::new(done.clone(), ImapIdleOptions::default());
        let deadline = Instant::now() + duration;
        let mut changed = false;

        let Self {
            stream,
            fragmentizer,
            buf,
            tags,
            in_flight,
            ..
        } = self;
        let mut tag;
        let mut arg: Option<&[u8]> = None;
        *in_flight = true;

        loop {
            match idle.resume(fragmentizer, arg.take()) {
                ImapCoroutineState::Complete(result) => {
                    *in_flight = false;
                    result.map_err(CoreError::protocol)?;
                    return Ok(changed);
                }
                ImapCoroutineState::Yielded(ImapIdleYield::Event(event)) => {
                    if !event.data.is_empty() {
                        changed = true;
                        done.store(true, Ordering::SeqCst);
                    }
                }
                ImapCoroutineState::Yielded(ImapIdleYield::WantsTag) => {
                    *tags += 1;
                    tag = format!("A{tags}");
                    arg = Some(tag.as_bytes());
                }
                ImapCoroutineState::Yielded(ImapIdleYield::WantsWrite(bytes)) => {
                    stream.write_all(&bytes).await?;
                }
                ImapCoroutineState::Yielded(ImapIdleYield::WantsRead) => {
                    // Once DONE is out, the tagged reply must be read whatever the time.
                    let remaining = if done.load(Ordering::SeqCst) {
                        DONE_TIMEOUT
                    } else {
                        deadline.saturating_duration_since(Instant::now())
                    };
                    if let Some(read) = transport::timeout(remaining, stream.read(buf)).await {
                        let n = read?;
                        if n == 0 {
                            return Err(CoreError::closed());
                        }
                        arg = Some(transport::filled(buf, n));
                    } else {
                        // Resuming without bytes makes the coroutine send DONE.
                        arg = None;
                        done.store(true, Ordering::SeqCst);
                    }
                }
            }
        }
    }

    pub(crate) async fn logout(mut self) -> Result<(), CoreError> {
        self.exec(ImapLogout::new()).await?;
        self.stream.close().await
    }
}

fn connected(stream: &mut Option<SecureStream>) -> Result<&mut SecureStream, CoreError> {
    stream
        .as_mut()
        .ok_or_else(|| CoreError::protocol("IMAP session asked for I/O before connecting"))
}

fn open_error(err: ImapSessionOpenError) -> CoreError {
    match err {
        ImapSessionOpenError::Login(_)
        | ImapSessionOpenError::InvalidLoginCredentials(_)
        | ImapSessionOpenError::AuthPlain(_)
        | ImapSessionOpenError::AuthLogin(_) => CoreError::auth(err),
        ImapSessionOpenError::StartTls(ImapStartTlsError::No(_) | ImapStartTlsError::Bad(_)) => {
            CoreError::tls(TlsFailure::StartTlsRefused, err)
        }
        ImapSessionOpenError::StartTls(_)
        | ImapSessionOpenError::StartTlsInjection
        | ImapSessionOpenError::StartTlsOverTls => CoreError::tls(TlsFailure::Other, err),
        _ => CoreError::protocol(err),
    }
}

pub(crate) fn mailbox_name(name: &str) -> Result<Mailbox<'static>, CoreError> {
    Mailbox::try_from(name.to_owned()).map_err(CoreError::invalid)
}

/// Packs UIDs into the shortest sequence set; `None` when there are none.
pub(crate) fn uid_set(uids: &[u32]) -> Option<SequenceSet> {
    let mut sorted: Vec<NonZeroU32> = uids
        .iter()
        .filter_map(|&uid| NonZeroU32::new(uid))
        .collect();
    sorted.sort_unstable();
    sorted.dedup();

    let mut sequences = Vec::new();
    let mut iter = sorted.into_iter().peekable();
    while let Some(start) = iter.next() {
        let mut end = start;
        while let Some(&next) = iter.peek() {
            if next.get() != end.get() + 1 {
                break;
            }
            end = next;
            iter.next();
        }
        sequences.push(if start == end {
            Sequence::Single(SeqOrUid::Value(start))
        } else {
            Sequence::Range(SeqOrUid::Value(start), SeqOrUid::Value(end))
        });
    }
    SequenceSet::try_from(sequences).ok()
}

/// `from:*`, or `from:to` when `to` is given.
pub(crate) fn range_set(from: u32, to: Option<u32>) -> Option<SequenceSet> {
    let from = SeqOrUid::Value(NonZeroU32::new(from)?);
    let to = match to {
        Some(to) => SeqOrUid::Value(NonZeroU32::new(to)?),
        None => SeqOrUid::Asterisk,
    };
    Some(Sequence::Range(from, to).into())
}
