//! Settings for hosts with neither autoconfig nor an ISPDB entry. Matched by
//! the address's domain or, for a custom domain, the registrable domain of
//! its MX. Entries come from the hosts' help pages; all use the full address
//! as username.

use crate::types::{DiscoveredSettings, Security, ServerConfig};

pub struct Provider {
    domains: &'static [&'static str],
    imap: &'static str,
    smtp: &'static str,
    carddav: Option<&'static str>,
}

const PROVIDERS: &[Provider] = &[
    // https://faq.infomaniak.com/2427. Contacts use a separate login, so no DAV URL here.
    Provider {
        domains: &["infomaniak.com", "infomaniak.ch"],
        imap: "mail.infomaniak.com",
        smtp: "mail.infomaniak.com",
        carddav: None,
    },
    // https://kb.mailbox.org/en/private/e-mail/e-mail-configuration/
    Provider {
        domains: &["mailbox.org"],
        imap: "imap.mailbox.org",
        smtp: "smtp.mailbox.org",
        carddav: Some("https://dav.mailbox.org"),
    },
    // https://www.fastmail.help/hc/en-us/articles/1500000278342-Server-names-and-ports
    Provider {
        domains: &["fastmail.com", "messagingengine.com"],
        imap: "imap.fastmail.com",
        smtp: "smtp.fastmail.com",
        carddav: Some("https://carddav.fastmail.com/"),
    },
    // https://help.runbox.com/email-program-settings/
    Provider {
        domains: &["runbox.com"],
        imap: "mail.runbox.com",
        smtp: "mail.runbox.com",
        carddav: None,
    },
    // https://purelymail.com/docs/setup/technical
    Provider {
        domains: &["purelymail.com"],
        imap: "imap.purelymail.com",
        smtp: "smtp.purelymail.com",
        carddav: Some("https://purelymail.com"),
    },
    // https://migadu.com/guides/
    Provider {
        domains: &["migadu.com"],
        imap: "imap.migadu.com",
        smtp: "smtp.migadu.com",
        carddav: Some("https://cdav.migadu.com"),
    },
];

pub fn find(domain: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|provider| {
        provider
            .domains
            .iter()
            .any(|known| known.eq_ignore_ascii_case(domain))
    })
}

impl Provider {
    pub fn settings(&self, email: &str, source: &str) -> DiscoveredSettings {
        let tls = |host: &str, port| ServerConfig {
            host: host.to_owned(),
            port,
            security: Security::Tls,
        };
        DiscoveredSettings {
            imap: Some(tls(self.imap, 993)),
            smtp: Some(tls(self.smtp, 465)),
            username: email.to_owned(),
            source: source.to_owned(),
            carddav_url: self.carddav.map(str::to_owned),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_host_is_found_by_any_of_its_domains_in_any_case() {
        let mx = find("MessagingEngine.com").expect("fastmail by its mail exchanger");
        assert_eq!(mx.imap, "imap.fastmail.com");
        assert!(find("example.org").is_none());
    }

    #[test]
    fn settings_use_implicit_tls_and_the_full_address() {
        let settings = find("infomaniak.ch")
            .expect("infomaniak")
            .settings("me@example.org", "mx");
        let smtp = settings.smtp.expect("outgoing server");
        assert_eq!(settings.imap.expect("incoming server").port, 993);
        assert_eq!(smtp.port, 465);
        assert_eq!(smtp.security, Security::Tls);
        assert_eq!(settings.username, "me@example.org");
    }
}
