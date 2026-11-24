//! Account settings discovery, in order: Mozilla autoconfig, Thunderbird
//! ISPDB, our table of hosts missing from it, RFC 6186 SRV, the host behind
//! the domain's MX (how Thunderbird finds a custom domain's provider), then
//! common host names. DNS goes over `DoH`; HTTP is io-http over a
//! [`SecureStream`].

use std::time::Duration;

use io_pim_discovery::{
    autoconfig::{
        config::DiscoveryAutoconfig,
        isp::DiscoveryIsp,
        mx::{DiscoveryDnsMx, MxRecord},
    },
    compose::config::{
        DiscoveryConfigSource, DiscoveryConfigTrust, DiscoveryEndpoint, DiscoverySecurity,
        DiscoveryService, DiscoveryServiceConfig,
    },
    coroutine::{DiscoveryCoroutine, DiscoveryCoroutineState, DiscoveryYield},
    rfc6186::{discover::DiscoverySrv, service::DiscoverySrvReport},
};
use url::Url;

use crate::{
    error::CoreError,
    probe, providers,
    tls::SecureStream,
    transport,
    types::{DiscoveredSettings, Security, ServerConfig},
};

// Quad9 refuses DNS-over-HTTPS on HTTP/1.1, which is all io-http speaks.
pub(crate) const DOH_RESOLVER: &str = "https://cloudflare-dns.com/dns-query";
const STEP_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) async fn discover(email: &str) -> Result<Option<DiscoveredSettings>, CoreError> {
    let (local_part, domain) = email
        .rsplit_once('@')
        .ok_or_else(|| CoreError::invalid("not an email address"))?;

    let autoconfig =
        DiscoveryIsp::main_url(local_part, domain, true).map_err(CoreError::invalid)?;
    if let Some(settings) = autoconfig_lookup(autoconfig, email, "autoconfig").await {
        return Ok(Some(settings));
    }
    if let Some(settings) = ispdb_lookup(domain, email, "ispdb").await? {
        return Ok(Some(settings));
    }
    if let Some(provider) = providers::find(domain) {
        return Ok(Some(provider.settings(email, "provider")));
    }

    let resolver = Url::parse(DOH_RESOLVER).map_err(CoreError::invalid)?;
    let srv = transport::timeout(
        STEP_TIMEOUT,
        run(DiscoverySrv::new(domain, resolver.clone())),
    )
    .await;
    if let Some(Ok(Ok(report))) = srv
        && let Some(settings) = from_srv(&report, email)
    {
        return Ok(Some(settings));
    }

    let exchangers = mail_exchangers(domain, resolver).await;
    if let Some(host) = foreign_host(&exchangers, domain) {
        if let Some(provider) = providers::find(&host) {
            return Ok(Some(provider.settings(email, "mx")));
        }
        if let Some(settings) = ispdb_lookup(&host, email, "mx").await? {
            return Ok(Some(settings));
        }
    }
    Ok(probe::probe(email, domain, exchange(&exchangers).as_deref()).await)
}

async fn ispdb_lookup(
    domain: &str,
    email: &str,
    source: &str,
) -> Result<Option<DiscoveredSettings>, CoreError> {
    let url = DiscoveryIsp::db_url(domain, true).map_err(CoreError::invalid)?;
    Ok(autoconfig_lookup(url, email, source).await)
}

async fn autoconfig_lookup(url: Url, email: &str, source: &str) -> Option<DiscoveredSettings> {
    let config = transport::timeout(STEP_TIMEOUT, run(DiscoveryIsp::new(url)))
        .await?
        .ok()?
        .ok()?;
    from_autoconfig(&config, email, source)
}

async fn mail_exchangers(domain: &str, resolver: Url) -> Vec<MxRecord> {
    transport::timeout(STEP_TIMEOUT, run(DiscoveryDnsMx::new(domain, resolver)))
        .await
        .and_then(Result::ok)
        .and_then(Result::ok)
        .unwrap_or_default()
}

/// The host of the domain's preferred mail exchanger; none for a null MX.
fn exchange(records: &[MxRecord]) -> Option<String> {
    let host = records.first()?.rdata.exchange.to_string();
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

/// Registrable domain of the preferred MX, when it is another domain: a
/// custom domain on Infomaniak has its mail at `mta-gw.infomaniak.ch`.
pub(crate) fn foreign_host(records: &[MxRecord], domain: &str) -> Option<String> {
    let exchange = exchange(records)?;
    let host = psl::domain_str(&exchange)?.to_ascii_lowercase();
    (!host.eq_ignore_ascii_case(domain)).then_some(host)
}

/// Drives a discovery coroutine, keeping one connection per origin it talks to.
pub(crate) async fn run<C, T, E>(mut coroutine: C) -> Result<Result<T, E>, CoreError>
where
    C: DiscoveryCoroutine<Yield = DiscoveryYield, Return = Result<T, E>>,
{
    let mut streams: Vec<(String, SecureStream)> = Vec::new();
    let mut buf = vec![0; transport::READ_CHUNK];
    let mut arg: Option<&[u8]> = None;

    let result = loop {
        match coroutine.resume(arg.take()) {
            DiscoveryCoroutineState::Complete(result) => break result,
            DiscoveryCoroutineState::Yielded(DiscoveryYield::WantsWrite { url, bytes }) => {
                stream_for(&mut streams, &url)
                    .await?
                    .write_all(&bytes)
                    .await?;
            }
            DiscoveryCoroutineState::Yielded(DiscoveryYield::WantsRead { url }) => {
                let n = stream_for(&mut streams, &url).await?.read(&mut buf).await?;
                arg = Some(transport::filled(&buf, n));
            }
        }
    };
    for (_, mut stream) in streams {
        // The answer is already in hand; a failed close changes nothing.
        let _ = stream.close().await;
    }
    Ok(result)
}

async fn stream_for<'a>(
    streams: &'a mut Vec<(String, SecureStream)>,
    url: &Url,
) -> Result<&'a mut SecureStream, CoreError> {
    let tls = match url.scheme() {
        "https" => true,
        "http" | "tcp" => false,
        scheme => return Err(CoreError::invalid(format!("unsupported scheme {scheme}"))),
    };
    let host = url
        .host_str()
        .ok_or_else(|| CoreError::invalid("URL without a host"))?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| CoreError::invalid("URL without a port"))?;
    let origin = format!("{}://{host}:{port}", url.scheme());

    if !streams.iter().any(|(known, _)| *known == origin) {
        let stream = SecureStream::connect(host, port, tls, None).await?;
        streams.push((origin.clone(), stream));
    }
    streams
        .iter_mut()
        .find(|(known, _)| *known == origin)
        .map(|(_, stream)| stream)
        .ok_or_else(CoreError::closed)
}

pub(crate) fn from_autoconfig(
    config: &DiscoveryAutoconfig,
    email: &str,
    source: &str,
) -> Option<DiscoveredSettings> {
    let configs = DiscoveryServiceConfig::from_autoconfig(
        config,
        email,
        DiscoveryConfigSource::Ispdb,
        DiscoveryConfigTrust::Unauthenticated,
    );
    let (imap, username) = configs
        .iter()
        .filter(|config| config.service == DiscoveryService::Imap)
        .find_map(|config| Some((server_config(config)?, &config.username)))?;
    let smtp = first_server(&configs, DiscoveryService::Smtp)?;

    Some(DiscoveredSettings {
        imap: Some(imap),
        smtp: Some(smtp),
        username: username.clone().unwrap_or_else(|| email.to_owned()),
        source: source.to_owned(),
        carddav_url: None,
    })
}

/// Only encrypted endpoints are offered.
fn server_config(config: &DiscoveryServiceConfig) -> Option<ServerConfig> {
    let DiscoveryEndpoint::Tcp {
        host,
        port,
        security,
    } = &config.endpoint
    else {
        return None;
    };
    let security = match security {
        DiscoverySecurity::Tls => Security::Tls,
        DiscoverySecurity::Starttls => Security::StartTls,
        DiscoverySecurity::Plain => return None,
    };
    Some(ServerConfig {
        host: host.clone(),
        port: *port,
        security,
    })
}

fn first_server(
    configs: &[DiscoveryServiceConfig],
    service: DiscoveryService,
) -> Option<ServerConfig> {
    configs
        .iter()
        .filter(|config| config.service == service)
        .find_map(server_config)
}

pub(crate) fn from_srv(report: &DiscoverySrvReport, email: &str) -> Option<DiscoveredSettings> {
    let configs = DiscoveryServiceConfig::from_srv(report);
    let pick = |service| {
        let mut server = first_server(&configs, service)?;
        // Some domains publish their implicit-TLS port under the STARTTLS name.
        if matches!(server.port, 465 | 993) {
            server.security = Security::Tls;
        }
        Some(server)
    };

    Some(DiscoveredSettings {
        imap: Some(pick(DiscoveryService::Imap)?),
        smtp: Some(pick(DiscoveryService::Smtp)?),
        username: email.to_owned(),
        source: "srv".to_owned(),
        carddav_url: None,
    })
}
