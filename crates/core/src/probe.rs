//! Last resort of discovery: common mail host names, each on its implicit-TLS
//! port, then STARTTLS. A guess passes when it greets over an encrypted
//! session; no password goes to it until the user signs in. If only one of
//! the two services answers, that one still comes back.

use std::time::Duration;

use futures_util::future::{join, join_all};

use crate::{
    error::CoreError,
    imap::ImapConn,
    smtp::SmtpConn,
    transport,
    types::{DiscoveredSettings, Security, ServerConfig},
};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const IMAP_PORTS: [(u16, Security); 2] = [(993, Security::Tls), (143, Security::StartTls)];
const SMTP_PORTS: [(u16, Security); 2] = [(465, Security::Tls), (587, Security::StartTls)];

pub async fn probe(
    email: &str,
    domain: &str,
    exchange: Option<&str>,
) -> Option<DiscoveredSettings> {
    let imap = candidates("imap", domain, exchange, IMAP_PORTS);
    let smtp = candidates("smtp", domain, exchange, SMTP_PORTS);
    let (imap, smtp) = join(
        first_answering(&imap, ImapConn::greet),
        first_answering(&smtp, SmtpConn::greet),
    )
    .await;
    found(email, imap, smtp)
}

fn found(
    email: &str,
    imap: Option<ServerConfig>,
    smtp: Option<ServerConfig>,
) -> Option<DiscoveredSettings> {
    if imap.is_none() && smtp.is_none() {
        return None;
    }
    Some(DiscoveredSettings {
        imap,
        smtp,
        username: email.to_owned(),
        source: "probe".to_owned(),
        carddav_url: None,
    })
}

/// In order of preference: `<service>.<domain>`, `mail.<domain>`, the bare domain, then the mail exchanger.
fn candidates(
    service: &str,
    domain: &str,
    exchange: Option<&str>,
    ports: [(u16, Security); 2],
) -> Vec<ServerConfig> {
    let domain = domain.to_ascii_lowercase();
    let mut hosts = vec![
        format!("{service}.{domain}"),
        format!("mail.{domain}"),
        domain,
    ];
    if let Some(exchange) = exchange
        && !hosts.iter().any(|host| host == exchange)
    {
        hosts.push(exchange.to_owned());
    }
    hosts
        .iter()
        .flat_map(|host| {
            ports.map(|(port, security)| ServerConfig {
                host: host.clone(),
                port,
                security,
            })
        })
        .collect()
}

/// Tries every candidate at once and keeps the most preferred one that answered.
async fn first_answering(
    candidates: &[ServerConfig],
    greet: impl AsyncFn(&ServerConfig) -> Result<(), CoreError>,
) -> Option<ServerConfig> {
    let answers = join_all(
        candidates
            .iter()
            .map(|server| transport::timeout(PROBE_TIMEOUT, greet(server))),
    )
    .await;
    candidates
        .iter()
        .zip(answers)
        .find_map(|(server, answer)| matches!(answer, Some(Ok(()))).then(|| server.clone()))
}

#[cfg(test)]
mod tests {
    use web_time::Instant;

    use super::{IMAP_PORTS, PROBE_TIMEOUT, SMTP_PORTS, candidates, found, probe};
    use crate::{imap::ImapConn, smtp::SmtpConn, types::Security};

    fn addresses(service: &str, exchange: Option<&str>) -> Vec<String> {
        let ports = if service == "imap" {
            IMAP_PORTS
        } else {
            SMTP_PORTS
        };
        candidates(service, "Example.org", exchange, ports)
            .into_iter()
            .map(|server| format!("{}:{}", server.host, server.port))
            .collect()
    }

    #[test]
    fn the_service_name_comes_first_then_mail_the_bare_domain_and_the_exchanger() {
        assert_eq!(
            addresses("imap", Some("mx.provider.net")),
            [
                "imap.example.org:993",
                "imap.example.org:143",
                "mail.example.org:993",
                "mail.example.org:143",
                "example.org:993",
                "example.org:143",
                "mx.provider.net:993",
                "mx.provider.net:143",
            ]
        );
    }

    #[test]
    fn outgoing_servers_are_tried_on_465_then_587() {
        assert_eq!(
            addresses("smtp", None)[..2],
            ["smtp.example.org:465", "smtp.example.org:587"]
        );
    }

    #[test]
    fn each_host_is_tried_with_implicit_tls_before_starttls() {
        let securities: Vec<_> = candidates("imap", "example.org", None, IMAP_PORTS)
            .into_iter()
            .map(|server| server.security)
            .collect();
        assert_eq!(securities[..2], [Security::Tls, Security::StartTls]);
    }

    #[test]
    fn an_exchanger_that_is_already_a_candidate_is_tried_once() {
        assert_eq!(addresses("imap", Some("mail.example.org")).len(), 6);
    }

    #[test]
    fn one_service_answering_is_kept_for_the_user_to_complete() {
        let imap = candidates("imap", "example.org", None, IMAP_PORTS).remove(0);
        let settings = found("me@example.org", Some(imap.clone()), None).expect("settings");
        assert_eq!(settings.imap, Some(imap));
        assert_eq!(settings.smtp, None);
        assert_eq!(settings.username, "me@example.org");
    }

    #[test]
    fn nothing_answering_finds_nothing() {
        assert_eq!(found("me@example.org", None, None), None);
    }

    #[tokio::test]
    async fn a_real_provider_greets_over_tls_and_starttls_on_both_services() {
        let imap = candidates("imap", "mailbox.org", None, IMAP_PORTS);
        if ImapConn::greet(&imap[0]).await.is_err() {
            eprintln!("skipped: imap.mailbox.org is unreachable");
            return;
        }
        ImapConn::greet(&imap[1]).await.expect("IMAP STARTTLS");
        for server in &candidates("smtp", "mailbox.org", None, SMTP_PORTS)[..2] {
            SmtpConn::greet(server).await.expect("SMTP");
        }
    }

    #[tokio::test]
    async fn a_domain_without_dns_gives_up_before_the_timeout() {
        let started = Instant::now();
        let found = probe("me@mailbowox.invalid", "mailbowox.invalid", None).await;
        assert!(found.is_none());
        assert!(started.elapsed() < PROBE_TIMEOUT, "{:?}", started.elapsed());
    }
}
