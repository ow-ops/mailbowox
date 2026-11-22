//! Gateway for mailbowox: a WebSocket-to-TCP relay for the web build, an encrypted vault store,
//! a rendezvous for linking devices, and content-free push for new mail.

mod config;
mod db;
mod limit;
mod link;
mod push;
mod relay;
mod vault;

use std::future::Future;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE, ETAG, IF_MATCH};
use axum::http::{Method, StatusCode};
use axum::routing::{delete, get, post, put};
use axum_prometheus::{EndpointLabel, PrometheusMetricLayerBuilder};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::timeout::TimeoutLayer;

/// The longest an api request may take, its body included: a registration logs in to an IMAP
/// server, and a client that stops sending must not hold its connection open.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
/// Far more than an access code needs.
const MAX_CODE_BYTES: usize = 1024;

pub use config::{ApnsConfig, Config, PushConfig, Roles};

pub struct AppState {
    config: Config,
    token_digests: Vec<[u8; 32]>,
    permits: Vec<Arc<Semaphore>>,
    vault: vault::Store,
    links: link::Store,
    push: Option<Arc<push::Push>>,
}

/// # Errors
///
/// Fails when the database can't be migrated or the APNs or FCM credentials can't be read.
pub async fn app(config: Config) -> Result<Router, Box<dyn std::error::Error>> {
    Ok(build(config).await?.0)
}

/// Serves until `shutdown` resolves, then hands this gateway's push leases to the others.
/// With `metrics`, Prometheus metrics are served there, off the public listener.
///
/// # Errors
///
/// Fails as [`app`] does, or when serving fails.
pub async fn serve(
    config: Config,
    listener: TcpListener,
    metrics: Option<TcpListener>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<(), Box<dyn std::error::Error>> {
    let (mut router, push) = build(config).await?;
    if let Some(metrics) = metrics {
        // The recorder is global, so it is installed here, once per process, and not in `app`.
        // Unmatched paths would otherwise label a series each, with whatever the client sent.
        let (layer, handle) = PrometheusMetricLayerBuilder::new()
            .with_endpoint_label_type(EndpointLabel::MatchedPathWithFallbackFn(|_| {
                "unmatched".to_owned()
            }))
            .with_default_metrics()
            .build_pair();
        router = router.layer(layer);
        let endpoint = Router::new().route("/metrics", get(move || async move { handle.render() }));
        tokio::spawn(async move {
            if let Err(error) = axum::serve(metrics, endpoint).await {
                tracing::error!(%error, "metrics listener stopped");
            }
        });
    }
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await?;
    if let Some(push) = push {
        push.release().await;
    }
    Ok(())
}

async fn health() {}

async fn build(
    config: Config,
) -> Result<(Router, Option<Arc<push::Push>>), Box<dyn std::error::Error>> {
    let roles = config.roles;
    let db = db::pool(&config.database_url)?;
    if roles.api || roles.push {
        db::migrate(&db, &config.database_url).await?;
    }
    let token_digests = config
        .tokens
        .iter()
        .map(|t| Sha256::digest(t.as_bytes()).into())
        .collect();
    let permits = config
        .tokens
        .iter()
        .map(|_| Arc::new(Semaphore::new(config.max_connections_per_token)))
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(config.allowed_origins.clone()))
        .allow_methods([Method::GET, Method::PUT, Method::POST, Method::DELETE])
        .allow_headers([AUTHORIZATION, IF_MATCH, CONTENT_TYPE])
        .expose_headers([ETAG]);
    let push = config
        .push
        .as_ref()
        .filter(|_| roles.api || roles.push)
        .map(|push| push::Push::start(push, db.clone(), roles.push, config.allow_private_targets))
        .transpose()?;
    let limits = roles.api.then(|| {
        limit::Limits::new(
            db.clone(),
            db::is_postgres(&config.database_url),
            config.trust_proxy,
        )
    });
    let state = Arc::new(AppState {
        vault: vault::Store::new(db.clone()),
        links: link::Store::new(db),
        push: push.clone(),
        config,
        token_digests,
        permits,
    });
    let any_origin = CorsLayer::new().allow_origin(Any);
    // The web app fetches it to check a relay address before using it; it tells no origin anything.
    let health = get(health).layer(any_origin.clone());
    let mut router = Router::new().route("/healthz", health);
    if roles.relay {
        let check = Router::new()
            .route("/relay/check", post(relay::check))
            .layer(DefaultBodyLimit::max(MAX_CODE_BYTES))
            .layer(any_origin);
        router = router.route("/relay", get(relay::handler)).merge(check);
    }
    if let Some(limits) = limits {
        let vault = Router::new()
            .route(
                "/vault/{id}",
                put(vault::put).get(vault::get).delete(vault::delete),
            )
            .layer(DefaultBodyLimit::max(vault::MAX_BLOB_BYTES))
            .layer(cors.clone());
        let link = Router::new()
            .route("/link/{id}", get(link::get))
            .layer(cors.clone());
        // A message waits two minutes, so this is also how many one client can have waiting: without
        // it a handful of clients could fill the store and keep everyone else from linking.
        let leave_link = limits.apply(
            Router::new()
                .route("/link/{id}", post(link::post))
                .layer(DefaultBodyLimit::max(link::MAX_MESSAGE_BYTES))
                .layer(cors),
            "link",
            Duration::from_mins(2),
            link::MAX_WAITING_PER_CLIENT,
        );
        // Each registration logs in to the IMAP server it names, so a loose limit would lend
        // the gateway to password guessing.
        let register = limits.apply(
            Router::new().route("/push/register", post(push::register)),
            "register",
            Duration::from_mins(5),
            5,
        );
        let api = limits.apply(
            Router::new()
                .route("/push/{id}", delete(push::unregister))
                .merge(vault)
                .merge(link),
            "api",
            Duration::from_secs(30),
            60,
        );
        let timeout = TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, REQUEST_TIMEOUT);
        router = router.merge(register.merge(api).merge(leave_link).layer(timeout));
    }
    Ok((router.with_state(state), push))
}
