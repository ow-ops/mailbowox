//! Entry points for the property tests into the parsers that read untrusted input.

use std::num::NonZeroU32;

use io_imap::types::{
    core::{AString, Literal, NString, Vec1},
    fetch::{MessageDataItem, Section},
};
use io_pim_discovery::{
    autoconfig::{isp::DiscoveryIsp, mx::DiscoveryDnsMx},
    coroutine::{DiscoveryCoroutine, DiscoveryCoroutineState, DiscoveryYield},
    rfc6186::discover::DiscoverySrv,
};
use url::Url;

use crate::{
    discover::{foreign_host, from_autoconfig, from_srv},
    types::{DiscoveredSettings, MessageSummary},
};

pub(crate) use crate::{
    body::{attachment, message_body},
    sanitize::sanitize_html,
    vcard::{contact, update_contact},
};

const MAX_STEPS: usize = 32;

pub(crate) fn summary(header: &[u8], text: &[u8]) -> Option<MessageSummary> {
    let fields = Vec1::try_from(vec![AString::try_from("SUBJECT").ok()?]).ok()?;
    crate::summary::summary(&[
        MessageDataItem::Uid(NonZeroU32::MIN),
        MessageDataItem::BodyExt {
            section: Some(Section::HeaderFields(None, fields)),
            origin: None,
            data: literal(header)?,
        },
        MessageDataItem::BodyExt {
            section: Some(Section::Text(None)),
            origin: None,
            data: literal(text)?,
        },
    ])
}

fn literal(bytes: &[u8]) -> Option<NString<'_>> {
    Literal::try_from(bytes).ok().map(NString::from)
}

/// `response` is what the server sends back to every request the coroutine makes.
fn drive<C, T>(mut coroutine: C, response: &[u8]) -> Option<T>
where
    C: DiscoveryCoroutine<Yield = DiscoveryYield, Return = T>,
{
    let mut pending = None;
    let mut arg: Option<&[u8]> = None;
    for _ in 0..MAX_STEPS {
        match coroutine.resume(arg.take()) {
            DiscoveryCoroutineState::Complete(result) => return Some(result),
            DiscoveryCoroutineState::Yielded(DiscoveryYield::WantsWrite { .. }) => {
                pending = Some(response);
            }
            DiscoveryCoroutineState::Yielded(DiscoveryYield::WantsRead { .. }) => {
                arg = Some(pending.take().unwrap_or_default());
            }
        }
    }
    None
}

fn url(path: &str) -> Url {
    Url::parse(path).expect("a constant URL")
}

pub(crate) fn autoconfig(response: &[u8]) -> Option<DiscoveredSettings> {
    let config = drive(
        DiscoveryIsp::new(url("https://autoconfig.example.org/")),
        response,
    )?
    .ok()?;
    from_autoconfig(&config, "me@example.org", "autoconfig")
}

pub(crate) fn srv(response: &[u8]) -> Option<DiscoveredSettings> {
    let resolver = url("https://dns.example.org/dns-query");
    let report = drive(DiscoverySrv::new("example.org", resolver), response)?.ok()?;
    from_srv(&report, "me@example.org")
}

pub(crate) fn mx(response: &[u8]) -> Option<String> {
    let resolver = url("https://dns.example.org/dns-query");
    let records = drive(DiscoveryDnsMx::new("example.org", resolver), response)?.ok()?;
    foreign_host(&records, "example.org")
}

#[cfg(test)]
mod tests {
    use super::{autoconfig, mx};
    use crate::types::Security;

    #[test]
    fn an_autoconfig_reply_gives_encrypted_settings_and_the_templated_username() {
        let settings = autoconfig(include_bytes!("../testdata/autoconfig.http")).expect("settings");
        let imap = settings.imap.expect("incoming server");
        let smtp = settings.smtp.expect("outgoing server");
        assert_eq!(imap.host, "imap.example.org");
        assert_eq!(imap.security, Security::Tls);
        assert_eq!(smtp.port, 587);
        assert_eq!(smtp.security, Security::StartTls);
        assert_eq!(settings.username, "me@example.org");
    }

    #[test]
    fn an_mx_reply_names_the_registrable_domain_of_the_exchanger() {
        let host = mx(include_bytes!("../testdata/mx.http"));
        assert_eq!(host.as_deref(), Some("example.net"));
    }
}
