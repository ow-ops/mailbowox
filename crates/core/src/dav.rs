//! Requests to DAV servers: io-webdav coroutines pumped over a
//! [`SecureStream`], one connection per request.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    time::Duration,
};

use io_http::rfc7617::basic::HttpAuthBasic;
use io_pim_discovery::{
    coroutine::{DiscoveryCoroutine, DiscoveryYield},
    rfc6764::{resolve::DiscoveryDavResolve, service::DiscoveryDavService, srv::DiscoveryDnsSrv},
};
use io_webdav::{
    coroutine::{WebdavCoroutine, WebdavCoroutineState, WebdavYield},
    rfc4918::{
        DAV, GETCTAG, GETETAG, WebdavAuth, WebdavProperty, coroutine::WebdavRedirectYield,
        follow_redirects::WebdavFollowRedirectsError, id_from_location, propfind::WebdavPropfind,
        resolve_href, send::WebdavSendError, typed::WebdavMultistatusOf,
    },
    rfc5397::current_user_principal::WebdavCurrentUserPrincipal,
    rfc6352::addressbook::home_set::CarddavAddressbookHomeSet,
    rfc6578::sync_collection::{
        WebdavSyncCollection, WebdavSyncCollectionError, WebdavSyncCollectionOptions,
        WebdavSyncDelta,
    },
};
use serde::Deserialize;
use url::Url;

use crate::{
    discover::{self, DOH_RESOLVER},
    error::CoreError,
    tls::{ANSWER_TIMEOUT, SecureStream},
    transport,
    types::{AccountConfig, Security},
};

pub(crate) const USER_AGENT: &str = "mailbowox";
pub(crate) const CURRENT_USER_PRIVILEGE_SET: WebdavProperty = WebdavProperty {
    ns: DAV,
    local: "current-user-privilege-set",
};
const MAX_REDIRECTS: usize = 5;
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(10);
const SERVICE: DiscoveryDavService = DiscoveryDavService::Carddav;

/// The child elements of a property, such as the resource types of a
/// collection.
#[derive(Debug, Default, Deserialize)]
#[expect(
    clippy::zero_sized_map_values,
    reason = "child elements are read as the keys of a map"
)]
pub(crate) struct Names(BTreeMap<String, ()>);

impl Names {
    pub(crate) fn contains(&self, name: &str) -> bool {
        self.0.contains_key(name)
    }
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct Privileges {
    #[serde(default)]
    privilege: Vec<Names>,
}

impl Privileges {
    fn can_write(&self) -> bool {
        self.privilege.iter().any(|privilege| {
            ["all", "write", "write-content"]
                .iter()
                .any(|name| privilege.contains(name))
        })
    }
}

/// A collection without a privilege set is taken as writable.
pub(crate) fn read_only(privileges: Option<Privileges>) -> bool {
    privileges.is_some_and(|privileges| !privileges.can_write())
}

#[derive(Debug, Default, Deserialize)]
struct CtagProps {
    getctag: Option<String>,
}

/// What a sync of one collection found, as hrefs to fetch and to forget.
pub(crate) struct Changes {
    pub sync_token: Option<String>,
    pub ctag: Option<String>,
    pub reset: bool,
    pub changed: Vec<String>,
    pub removed: Vec<String>,
    /// Listed but unreadable: neither changed nor removed.
    pub kept: Vec<String>,
}

pub(crate) struct Dav {
    pub auth: WebdavAuth,
    allow_plain: bool,
}

impl Dav {
    pub(crate) fn new(config: &AccountConfig) -> Self {
        let credentials = &config.credentials;
        Self {
            auth: WebdavAuth::Basic(HttpAuthBasic::new(
                credentials.username.clone(),
                credentials.password.clone(),
            )),
            allow_plain: config.imap.security == Security::Plain
                && config
                    .carddav_url
                    .as_deref()
                    .is_some_and(|url| url.starts_with("http://")),
        }
    }

    pub(crate) fn url(&self, url: &str) -> Result<Url, CoreError> {
        let url = Url::parse(url).map_err(CoreError::invalid)?;
        match url.scheme() {
            "https" => Ok(url),
            "http" if self.allow_plain => Ok(url),
            scheme => Err(CoreError::invalid(format!("unsupported scheme {scheme}"))),
        }
    }

    /// The coroutine's own result comes back as is, for callers that tell
    /// its errors apart.
    pub(crate) async fn run<C, T, E>(
        &self,
        url: &Url,
        mut coroutine: C,
    ) -> Result<Result<T, E>, CoreError>
    where
        C: WebdavCoroutine<Yield = WebdavYield, Return = Result<T, E>>,
    {
        let mut stream = connect(url).await?;
        let mut buf = vec![0; transport::READ_CHUNK];
        let mut arg: Option<&[u8]> = None;
        let result = loop {
            match coroutine.resume(arg.take()) {
                WebdavCoroutineState::Complete(result) => break result,
                WebdavCoroutineState::Yielded(WebdavYield::WantsWrite(bytes)) => {
                    stream.write_all(&bytes).await?;
                }
                WebdavCoroutineState::Yielded(WebdavYield::WantsRead) => {
                    let n = stream.read_within(&mut buf, ANSWER_TIMEOUT).await?;
                    arg = Some(transport::filled(&buf, n));
                }
            }
        };
        // The answer is already in hand; a failed close changes nothing.
        let _ = stream.close().await;
        Ok(result)
    }

    /// Runs a coroutine built for `url`, rebuilding it for each same-origin
    /// redirect. Credentials never follow a redirect to another origin.
    pub(crate) async fn run_following<C, T>(
        &self,
        mut url: Url,
        build: impl Fn(&Url) -> C,
    ) -> Result<T, CoreError>
    where
        C: WebdavCoroutine<
                Yield = WebdavRedirectYield,
                Return = Result<T, WebdavFollowRedirectsError>,
            >,
    {
        for _ in 0..=MAX_REDIRECTS {
            let mut coroutine = build(&url);
            let mut stream = connect(&url).await?;
            let mut buf = vec![0; transport::READ_CHUNK];
            let mut arg: Option<&[u8]> = None;
            let step = loop {
                match coroutine.resume(arg.take()) {
                    WebdavCoroutineState::Complete(result) => break Ok(result),
                    WebdavCoroutineState::Yielded(WebdavRedirectYield::WantsWrite(bytes)) => {
                        stream.write_all(&bytes).await?;
                    }
                    WebdavCoroutineState::Yielded(WebdavRedirectYield::WantsRead) => {
                        let n = stream.read_within(&mut buf, ANSWER_TIMEOUT).await?;
                        arg = Some(transport::filled(&buf, n));
                    }
                    WebdavCoroutineState::Yielded(WebdavRedirectYield::WantsRedirect {
                        url,
                        same_origin,
                        ..
                    }) => break Err((url, same_origin)),
                }
            };
            let _ = stream.close().await;
            match step {
                Ok(result) => return result.map_err(Into::into),
                Err((next, true)) => url = next,
                Err((next, false)) => {
                    return Err(CoreError::protocol(format!("redirected to {next}")));
                }
            }
        }
        Err(CoreError::protocol("too many redirects"))
    }

    pub(crate) async fn discover(
        &self,
        config: &AccountConfig,
    ) -> Result<Option<String>, CoreError> {
        let roots = match config.carddav_url.as_deref() {
            Some(url) => server_roots(self.url(url)?),
            None => context_roots(config).await,
        };
        for root in roots {
            match self.home(root).await {
                Ok(Some(home)) => return Ok(Some(home.into())),
                Err(err @ CoreError::Auth { .. }) => return Err(err),
                Ok(None) | Err(_) => {}
            }
        }
        Ok(None)
    }

    async fn home(&self, root: Url) -> Result<Option<Url>, CoreError> {
        let principal = self
            .run_following(root.clone(), |url| {
                WebdavCurrentUserPrincipal::new(url, &self.auth, USER_AGENT)
            })
            .await?
            .unwrap_or(root);
        let home = self
            .run_following(principal, |url| {
                CarddavAddressbookHomeSet::new(url, &self.auth, USER_AGENT, "")
            })
            .await?;
        home.map(|home| self.url(home.as_str())).transpose()
    }

    /// sync-collection when the collection supports it, else the ctag and an
    /// etag listing diffed against `known` (href to etag).
    pub(crate) async fn sync(
        &self,
        collection: &Url,
        since_token: Option<&str>,
        since_ctag: Option<String>,
        known: &HashMap<&str, &str>,
    ) -> Result<Changes, CoreError> {
        if since_token.is_none() && since_ctag.is_some() {
            return self.sync_by_ctag(collection, since_ctag, known).await;
        }

        let (delta, reset) = match self.changes(collection, since_token).await? {
            Ok(delta) => (delta, since_token.is_none()),
            Err(WebdavSyncCollectionError::InvalidSyncToken) => {
                (self.changes(collection, None).await??, true)
            }
            Err(WebdavSyncCollectionError::UnsupportedReport) => {
                return self.sync_by_ctag(collection, since_ctag, known).await;
            }
            Err(err) => return Err(err.into()),
        };
        Ok(Changes {
            sync_token: delta.sync_token,
            ctag: None,
            reset,
            changed: delta
                .changed
                .iter()
                .filter_map(|change| absolute(collection, &change.href))
                .collect(),
            removed: delta
                .vanished
                .iter()
                .filter_map(|href| absolute(collection, href))
                .collect(),
            kept: delta
                .unreadable
                .iter()
                .filter_map(|entry| absolute(collection, &entry.href))
                .collect(),
        })
    }

    /// The sync-collection REPORT, run again from each new token while the
    /// server truncates its answer.
    async fn changes(
        &self,
        collection: &Url,
        token: Option<&str>,
    ) -> Result<Result<WebdavSyncDelta, WebdavSyncCollectionError>, CoreError> {
        let report = |token: Option<&str>| {
            WebdavSyncCollection::new(
                collection,
                &self.auth,
                USER_AGENT,
                collection.path(),
                token,
                &[GETETAG],
                WebdavSyncCollectionOptions::default(),
            )
        };
        let mut delta = match self.run(collection, report(token)).await? {
            Ok(delta) => delta,
            Err(err) => return Ok(Err(err)),
        };
        while delta.truncated {
            let next = self
                .run(collection, report(delta.sync_token.as_deref()))
                .await??;
            delta.changed.extend(next.changed);
            delta.vanished.extend(next.vanished);
            delta.unreadable.extend(next.unreadable);
            delta.sync_token = next.sync_token;
            delta.truncated = next.truncated;
        }
        Ok(Ok(delta))
    }

    /// For servers without sync-collection: nothing changed while the ctag
    /// holds, else the etag listing is diffed against `known`.
    async fn sync_by_ctag(
        &self,
        collection: &Url,
        since: Option<String>,
        known: &HashMap<&str, &str>,
    ) -> Result<Changes, CoreError> {
        let propfind = WebdavPropfind::<WebdavMultistatusOf<CtagProps>>::new(
            collection,
            &self.auth,
            USER_AGENT,
            "",
            0,
            &[GETCTAG],
        );
        let ctag = self
            .run(collection, propfind)
            .await??
            .responses
            .into_iter()
            .find_map(|response| response.props.getctag);
        if ctag.is_some() && ctag == since {
            return Ok(Changes {
                sync_token: None,
                ctag,
                reset: false,
                changed: Vec::new(),
                removed: Vec::new(),
                kept: Vec::new(),
            });
        }

        let listing = WebdavSyncCollection::new(
            collection,
            &self.auth,
            USER_AGENT,
            collection.path(),
            None,
            &[GETETAG],
            WebdavSyncCollectionOptions { fallback: true },
        );
        let listing = self.run(collection, listing).await??;
        let mut present = HashSet::new();
        let mut changed = Vec::new();
        for item in listing.changed {
            let Some(href) = absolute(collection, &item.href) else {
                continue;
            };
            if item.etag.is_none() || known.get(href.as_str()).copied() != item.etag.as_deref() {
                changed.push(href.clone());
            }
            present.insert(href);
        }
        let kept: Vec<String> = listing
            .unreadable
            .iter()
            .filter_map(|entry| absolute(collection, &entry.href))
            .collect();
        present.extend(kept.iter().cloned());

        Ok(Changes {
            sync_token: None,
            ctag,
            reset: false,
            changed,
            removed: known
                .keys()
                .filter(|href| !present.contains(**href))
                .map(|href| (*href).to_owned())
                .collect(),
            kept,
        })
    }

    /// The resource at `href`, the collection holding it and its id.
    pub(crate) fn locate(&self, href: &str) -> Result<(Url, Url, String), CoreError> {
        let href = self.url(href)?;
        let collection = href.join(".").map_err(CoreError::invalid)?;
        let id = id_from_location(href.path())
            .ok_or_else(|| CoreError::invalid("not a resource URL"))?;
        Ok((href, collection, id))
    }
}

/// `None` for an href on another origin: the account's credentials only go
/// to the server the collection is on.
pub(crate) fn absolute(collection: &Url, href: &str) -> Option<String> {
    same_origin_url(collection, href).map(String::from)
}

pub(crate) fn same_origin_url(base: &Url, href: &str) -> Option<Url> {
    resolve_href(base, href).filter(|url| url.origin() == base.origin())
}

/// The server's well-known URL, then the URL as given.
fn server_roots(url: Url) -> Vec<Url> {
    url.join(SERVICE.well_known_path())
        .into_iter()
        .chain([url])
        .collect()
}

/// RFC 6764 on the email domain, then on the domain of the IMAP host, which
/// is where hosted providers such as Migadu publish their records.
async fn context_roots(config: &AccountConfig) -> Vec<Url> {
    let Ok(resolver) = Url::parse(DOH_RESOLVER) else {
        return Vec::new();
    };
    let mut domains: Vec<&str> = config
        .email
        .rsplit_once('@')
        .map(|(_, domain)| domain)
        .into_iter()
        .collect();
    if let Some(provider) = psl::domain_str(&config.imap.host)
        && !domains.contains(&provider)
    {
        domains.push(provider);
    }

    let mut roots = Vec::new();
    for domain in domains {
        if let Some(origin) = srv_origin(domain, &resolver).await {
            roots.push(origin);
            continue;
        }
        let resolve =
            DiscoveryDavResolve::new(domain, SERVICE, resolver.clone()).with_secure_only(true);
        if let Some(found) = lookup(resolve).await {
            roots.push(found.root);
        }
    }
    roots
}

/// The secure SRV record, looked up alone: `DiscoveryDavResolve` gives up
/// when the plain lookup fails, as on Migadu, whose proofs of non-existence
/// don't validate.
async fn srv_origin(domain: &str, resolver: &Url) -> Option<Url> {
    let query = DiscoveryDnsSrv::new(SERVICE.srv_qname(true, domain), resolver.clone());
    let records = lookup(query).await?;
    let record = records.first()?;
    let host = record.rdata.name.to_string();
    let origin = format!(
        "https://{}:{}/",
        host.trim_end_matches('.'),
        record.rdata.port.get()
    );
    Url::parse(&origin).ok()
}

async fn lookup<C, T, E>(coroutine: C) -> Option<T>
where
    C: DiscoveryCoroutine<Yield = DiscoveryYield, Return = Result<T, E>>,
{
    match transport::timeout(LOOKUP_TIMEOUT, discover::run(coroutine)).await {
        Some(Ok(Ok(found))) => Some(found),
        _ => None,
    }
}

async fn connect(url: &Url) -> Result<SecureStream, CoreError> {
    let host = url
        .host_str()
        .ok_or_else(|| CoreError::invalid("URL without a host"))?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| CoreError::invalid("URL without a port"))?;
    SecureStream::connect(host, port, url.scheme() == "https", None).await
}

fn status_error(status: u16, err: impl ToString) -> CoreError {
    match status {
        401 | 403 => CoreError::auth(err),
        404 | 410 => CoreError::not_found(err),
        _ => CoreError::protocol(err),
    }
}

impl From<WebdavSendError> for CoreError {
    fn from(err: WebdavSendError) -> Self {
        match &err {
            WebdavSendError::HttpStatus { status, .. } => status_error(*status, err),
            _ => Self::protocol(err),
        }
    }
}

impl From<WebdavFollowRedirectsError> for CoreError {
    fn from(err: WebdavFollowRedirectsError) -> Self {
        match &err {
            WebdavFollowRedirectsError::HttpStatus { status, .. } => status_error(*status, err),
            _ => Self::protocol(err),
        }
    }
}

impl From<WebdavSyncCollectionError> for CoreError {
    fn from(err: WebdavSyncCollectionError) -> Self {
        match err {
            WebdavSyncCollectionError::Send(err) => err.into(),
            err => Self::protocol(err),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::same_origin_url;
    use url::Url;

    #[test]
    fn resource_urls_stay_on_the_authenticated_origin() {
        let base = Url::parse("https://dav.example.test/addressbook/").unwrap();
        let item = same_origin_url(&base, "contact.vcf").unwrap();
        assert_eq!(item.path(), "/addressbook/contact.vcf");
        assert!(same_origin_url(&base, "https://dav.example.test/contact.vcf").is_some());
        assert!(same_origin_url(&base, "https://other.example.test/contact.vcf").is_none());
        assert!(same_origin_url(&base, "http://dav.example.test/contact.vcf").is_none());
    }
}
