use std::io;

/// Why TLS could not be set up, for telling the common misconfigurations apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TlsFailure {
    /// The server answered in plain text: TLS on a port that doesn't speak it.
    NotTls,
    /// The server has no STARTTLS or refused it.
    StartTlsRefused,
    /// The certificate is expired, untrusted or for another name.
    Certificate,
    Other,
}

impl From<&rustls::Error> for TlsFailure {
    fn from(err: &rustls::Error) -> Self {
        match err {
            rustls::Error::InvalidMessage(_) => Self::NotTls,
            rustls::Error::InvalidCertificate(_) | rustls::Error::NoCertificatesPresented => {
                Self::Certificate
            }
            _ => Self::Other,
        }
    }
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    #[error("network: {message}")]
    /// A connection that fails, or a server that takes over 15 s to connect or
    /// greet, or stops answering for 60 s.
    Network { message: String },
    #[error("tls: {message}")]
    Tls { reason: TlsFailure, message: String },
    #[error("authentication failed: {message}")]
    Auth { message: String },
    #[error("protocol: {message}")]
    Protocol { message: String },
    #[error("not found: {message}")]
    NotFound { message: String },
    #[error("invalid: {message}")]
    /// The input was rejected: a blank search, a bad URL scheme or address.
    Invalid { message: String },
    #[error("storage: {message}")]
    Storage { message: String },
    /// The connection failed after the whole message had gone to the SMTP server and before it answered, so the
    /// server may have accepted it.
    #[error("unconfirmed: {message}")]
    Unconfirmed { message: String },
}

#[expect(
    clippy::needless_pass_by_value,
    reason = "taken by value so they fit map_err"
)]
impl CoreError {
    pub(crate) fn protocol(err: impl ToString) -> Self {
        Self::Protocol {
            message: err.to_string(),
        }
    }

    pub(crate) fn invalid(err: impl ToString) -> Self {
        Self::Invalid {
            message: err.to_string(),
        }
    }

    pub(crate) fn not_found(err: impl ToString) -> Self {
        Self::NotFound {
            message: err.to_string(),
        }
    }

    pub(crate) fn storage(err: impl ToString) -> Self {
        Self::Storage {
            message: err.to_string(),
        }
    }

    pub(crate) fn auth(err: impl ToString) -> Self {
        Self::Auth {
            message: err.to_string(),
        }
    }

    pub(crate) fn tls(reason: TlsFailure, err: impl ToString) -> Self {
        Self::Tls {
            reason,
            message: err.to_string(),
        }
    }

    pub(crate) fn closed() -> Self {
        Self::Network {
            message: "the server closed the connection".to_owned(),
        }
    }
}

impl From<io::Error> for CoreError {
    fn from(err: io::Error) -> Self {
        err.get_ref()
            .and_then(|inner| inner.downcast_ref::<rustls::Error>())
            .map_or_else(
                || Self::Network {
                    message: err.to_string(),
                },
                |tls| Self::tls(tls.into(), tls),
            )
    }
}
