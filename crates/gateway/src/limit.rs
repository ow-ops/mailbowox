//! Per-client rate limits on the api routes, in fixed windows. Counts live in memory, or in the
//! database when gateways share Postgres, so behind a load balancer a client gets one allowance,
//! not one per process. `tower_governor` can't be shared: its store is in-memory.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use axum::Router;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::StatusCode;
use axum::http::header::RETRY_AFTER;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};
use sqlx::AnyPool;
use tracing::error;

use crate::db::unix_now;

enum Counter {
    /// The window's end and the hits so far, by client.
    Memory(Mutex<HashMap<String, (i64, i64)>>),
    Database(AnyPool),
}

impl Counter {
    /// Counts one hit in the window ending at `expires_at` and returns the window's total.
    async fn hit(&self, client: &str, expires_at: i64) -> Result<i64, sqlx::Error> {
        match self {
            Self::Memory(windows) => {
                let mut windows = windows.lock().unwrap_or_else(PoisonError::into_inner);
                let (end, hits) = windows.entry(client.to_owned()).or_insert((expires_at, 0));
                if *end != expires_at {
                    (*end, *hits) = (expires_at, 0);
                }
                *hits += 1;
                Ok(*hits)
            }
            Self::Database(db) => {
                let (hits,): (i64,) = sqlx::query_as(
                    "INSERT INTO rate_window (client, expires_at, hits) VALUES ($1, $2, 1)
                     ON CONFLICT (client, expires_at) DO UPDATE SET hits = rate_window.hits + 1
                     RETURNING hits",
                )
                .bind(client)
                .bind(expires_at)
                .fetch_one(db)
                .await?;
                Ok(hits)
            }
        }
    }

    async fn purge(&self, now: i64) -> Result<(), sqlx::Error> {
        match self {
            Self::Memory(windows) => windows
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .retain(|_, (end, _)| *end > now),
            Self::Database(db) => {
                sqlx::query("DELETE FROM rate_window WHERE expires_at <= $1")
                    .bind(now)
                    .execute(db)
                    .await?;
            }
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct Limits {
    counter: Arc<Counter>,
    trust_proxy: bool,
}

impl Limits {
    /// Counts in `db` when `shared`, in memory otherwise. With `trust_proxy` the client is the
    /// address the proxy appended to `X-Forwarded-For`, not the peer; a client reaching the
    /// gateway directly could forge it.
    pub fn new(db: AnyPool, shared: bool, trust_proxy: bool) -> Self {
        let counter = Arc::new(if shared {
            Counter::Database(db)
        } else {
            Counter::Memory(Mutex::new(HashMap::new()))
        });
        let weak = Arc::downgrade(&counter);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_mins(1)).await;
                let Some(counter) = weak.upgrade() else {
                    return;
                };
                if let Err(error) = counter.purge(unix_now()).await {
                    error!(%error, "could not purge the rate limit windows");
                }
            }
        });
        Self {
            counter,
            trust_proxy,
        }
    }

    /// Lets each client make `max` requests to `router` per `window`. `scope` keeps the
    /// counts of different routes apart.
    pub fn apply<S>(
        &self,
        router: Router<S>,
        scope: &'static str,
        window: Duration,
        max: i64,
    ) -> Router<S>
    where
        S: Clone + Send + Sync + 'static,
    {
        let rule = Arc::new(Rule {
            limits: self.clone(),
            scope,
            window: i64::try_from(window.as_secs()).expect("a window is not centuries"),
            max,
        });
        router.layer(middleware::from_fn_with_state(rule, enforce))
    }
}

struct Rule {
    limits: Limits,
    scope: &'static str,
    window: i64,
    max: i64,
}

async fn enforce(State(rule): State<Arc<Rule>>, request: Request, next: Next) -> Response {
    let Some(ip) = client_ip(&request, rule.limits.trust_proxy) else {
        error!("rate limit found no client address");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    // Rows hold a hash, not the address, and last no longer than the window.
    let client = hex::encode(Sha256::digest(format!("{}\0{ip}", rule.scope)));
    let now = unix_now();
    let expires_at = now - now % rule.window + rule.window;
    match rule.limits.counter.hit(&client, expires_at).await {
        Ok(hits) if hits <= rule.max => next.run(request).await,
        Ok(_) => (
            StatusCode::TOO_MANY_REQUESTS,
            [(RETRY_AFTER, (expires_at - now).to_string())],
        )
            .into_response(),
        Err(error) => {
            error!(%error, "could not count a request for rate limiting");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// IPv6 clients are counted by /64, as a single one holds far more addresses than any limit
/// could tell apart.
fn client_ip(request: &Request, trust_proxy: bool) -> Option<IpAddr> {
    // The trusted proxy writes last, whether it appends to a line or adds one of its own.
    let forwarded = trust_proxy
        .then(|| client_ip::rightmost_x_forwarded_for(request.headers()).ok())
        .flatten();
    let ip = match forwarded {
        Some(ip) => ip,
        None => request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()?
            .0
            .ip(),
    };
    Some(match ip.to_canonical() {
        IpAddr::V6(ip) => IpAddr::V6((u128::from(ip) & (u128::MAX << 64)).into()),
        ip @ IpAddr::V4(_) => ip,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;

    #[tokio::test]
    async fn memory_counts_per_window_and_forgets_old_ones() {
        let counter = Counter::Memory(Mutex::new(HashMap::new()));
        assert_eq!(counter.hit("a", 60).await.unwrap(), 1);
        assert_eq!(counter.hit("a", 60).await.unwrap(), 2);
        assert_eq!(counter.hit("b", 60).await.unwrap(), 1);
        assert_eq!(counter.hit("a", 120).await.unwrap(), 1);
        counter.purge(120).await.unwrap();
        assert_eq!(counter.hit("b", 180).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn gateways_sharing_a_database_share_the_count() {
        let (db, _dir) = test_pool().await;
        let (first, second) = (Counter::Database(db.clone()), Counter::Database(db.clone()));
        assert_eq!(first.hit("a", 60).await.unwrap(), 1);
        assert_eq!(second.hit("a", 60).await.unwrap(), 2);
        assert_eq!(second.hit("a", 120).await.unwrap(), 1);

        first.purge(60).await.unwrap();
        let (rows,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM rate_window")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn the_proxy_names_the_client_only_when_trusted() {
        let request = |forwarded: &str| {
            let mut request = Request::new(axum::body::Body::empty());
            request
                .headers_mut()
                .insert("x-forwarded-for", forwarded.parse().unwrap());
            request
                .extensions_mut()
                .insert(ConnectInfo(SocketAddr::from(([10, 0, 0, 1], 1))));
            request
        };
        let spoofed = request("1.1.1.1, 198.51.100.9");
        assert_eq!(client_ip(&spoofed, false), Some([10, 0, 0, 1].into()));
        assert_eq!(client_ip(&spoofed, true), Some([198, 51, 100, 9].into()));

        let mut two_lines = request("1.1.1.1");
        two_lines
            .headers_mut()
            .append("x-forwarded-for", "198.51.100.9".parse().unwrap());
        assert_eq!(client_ip(&two_lines, true), Some([198, 51, 100, 9].into()));
    }

    #[test]
    fn an_ipv6_client_is_counted_by_its_64() {
        let request = |ip: [u16; 8]| {
            let mut request = Request::new(axum::body::Body::empty());
            request
                .extensions_mut()
                .insert(ConnectInfo(SocketAddr::from((ip, 1))));
            request
        };
        let a = client_ip(&request([0x2001, 0xdb8, 1, 2, 3, 4, 5, 6]), false);
        let b = client_ip(&request([0x2001, 0xdb8, 1, 2, 9, 9, 9, 9]), false);
        let c = client_ip(&request([0x2001, 0xdb8, 1, 3, 3, 4, 5, 6]), false);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }
}
