use std::env;
use std::net::SocketAddr;

use mailbowox_gateway::{Config, serve};
use tokio::signal::unix::{SignalKind, signal};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::builder()
                .with_default_directive(tracing::Level::INFO.into())
                .from_env_lossy(),
        )
        .init();
    // The core brings rustls's ring provider and reqwest its aws-lc-rs one, so rustls cannot
    // pick a default by itself.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let config = Config::from_env()?;
    let roles = config.roles;
    if roles.relay && config.tokens.is_empty() {
        warn!("GATEWAY_TOKENS is empty, /relay will refuse every connection");
    }
    if (roles.api || roles.push) && config.push.is_none() {
        warn!("PUSH_SECRET_KEY is not set, /push will answer 503 and no inbox is watched");
    }
    let addr: SocketAddr = env::var("BIND")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_owned())
        .parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let metrics = match env::var("METRICS_BIND") {
        Ok(addr) => Some(tokio::net::TcpListener::bind(addr.parse::<SocketAddr>()?).await?),
        Err(_) => None,
    };
    info!(%addr, api = roles.api, relay = roles.relay, push = roles.push, "mailbowox gateway listening");
    let mut sigterm = signal(SignalKind::terminate())?;
    serve(config, listener, metrics, async move {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = sigterm.recv() => {}
        }
    })
    .await
}
