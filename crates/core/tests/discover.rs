use std::{
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};

use mailbowox_core::{Security, discover};

/// Discovery asks public DNS-over-HTTPS and the ISPDB, so these tests need the internet.
fn online() -> Option<()> {
    let reachable = ("cloudflare-dns.com", 443)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .is_some_and(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok());
    if !reachable {
        eprintln!("skipped: cloudflare-dns.com is unreachable");
    }
    reachable.then_some(())
}

#[tokio::test]
async fn a_domain_with_nothing_published_is_found_through_its_mail_exchanger() {
    if online().is_none() {
        return;
    }
    // runbox.no publishes no autoconfig, no ISPDB entry and no SRV records, like most custom domains; its MX
    // record points at mx.runbox.com.
    let settings = discover("someone@runbox.no".into())
        .await
        .expect("discovery runs")
        .expect("settings for runbox.no");
    assert_eq!(settings.source, "mx");
    let imap = settings.imap.expect("incoming server");
    assert_eq!(imap.host, "mail.runbox.com");
    assert_eq!(imap.security, Security::Tls);
    assert_eq!(settings.username, "someone@runbox.no");
}
