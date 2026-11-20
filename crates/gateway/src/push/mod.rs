//! Push for new mail. The gateway holds an IMAP IDLE connection per registered inbox and pings
//! the device with a hash of the account and its unread count; the app syncs for the rest.
//! Gateways with the api role take registrations; those with the push role share the watching
//! through database leases.

mod key;
mod sender;
mod store;
mod watcher;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use mailbowox_core::{AddrFilter, CoreError, Credentials, MailSession, ServerConfig};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::AnyPool;
use tokio::sync::Notify;
use tokio::task::AbortHandle;
use tracing::{error, info, warn};

use crate::AppState;
use crate::config::PushConfig;
use crate::db::unix_now;
use crate::relay::{is_public, resolve};
use crate::vault::bearer;

use sender::Providers;
use store::{Removal, Store, new_id, new_secret};
use watcher::{Checkpoint, Seen, watch};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Platform {
    Ios,
    /// Development-signed iOS builds, whose tokens only the APNs sandbox accepts.
    IosSandbox,
    Android,
}

impl Platform {
    fn valid_token(self, token: &str) -> bool {
        match self {
            Self::Ios | Self::IosSandbox => {
                (1..=200).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_hexdigit())
            }
            Self::Android => {
                (1..=512).contains(&token.len())
                    && token
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':'))
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Security {
    Tls,
    StartTls,
    Plain,
}

/// The body of `POST /push/register`, and what is sealed on disk.
#[derive(Clone, Serialize, Deserialize)]
pub struct Registration {
    pub platform: Platform,
    pub token: String,
    pub email: String,
    pub host: String,
    pub port: u16,
    pub security: Security,
    pub username: String,
    pub password: String,
}

/// What `POST /push/register` answers. The secret is shown once; `DELETE /push/{id}` needs it.
#[derive(Serialize)]
struct Registered {
    id: String,
    secret: String,
}

impl Registration {
    fn imap(&self) -> ServerConfig {
        ServerConfig {
            host: self.host.clone(),
            port: self.port,
            security: match self.security {
                Security::Tls => mailbowox_core::Security::Tls,
                Security::StartTls => mailbowox_core::Security::StartTls,
                Security::Plain => mailbowox_core::Security::Plain,
            },
        }
    }

    fn credentials(&self) -> Credentials {
        Credentials {
            username: self.username.clone(),
            password: self.password.clone(),
        }
    }
}

const LEASE_SECS: i64 = 60;
const RENEW_EVERY: Duration = Duration::from_secs(20);
const CLAIM_BATCH: usize = 500;

pub struct Push {
    store: Store,
    providers: Providers,
    max_per_device: usize,
    /// The addresses an IMAP server may have; `None` allows any.
    allowed: Option<AddrFilter>,
    worker: Option<Worker>,
}

struct Worker {
    id: String,
    capacity: usize,
    watchers: Mutex<HashMap<String, AbortHandle>>,
    leased_until: AtomicI64,
    wake: Notify,
    /// Set at shutdown, so the lease loop claims nothing more once the leases are handed back.
    stopping: AtomicBool,
}

impl Worker {
    fn new(capacity: usize) -> Result<Self, getrandom::Error> {
        Ok(Self {
            id: new_id()?,
            capacity,
            watchers: Mutex::new(HashMap::new()),
            leased_until: AtomicI64::new(0),
            wake: Notify::new(),
            stopping: AtomicBool::new(false),
        })
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, AbortHandle>> {
        self.watchers.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Push {
    /// With `watch`, this gateway also takes a share of the registrations and watches them.
    /// Without `allow_private`, IMAP servers on internal addresses are refused.
    pub fn start(
        config: &PushConfig,
        db: AnyPool,
        watch: bool,
        allow_private: bool,
    ) -> Result<Arc<Self>, Box<dyn std::error::Error>> {
        let worker = if watch {
            Some(Worker::new(config.capacity)?)
        } else {
            None
        };
        let push = Arc::new(Self {
            store: Store::new(db, &config.secret_key, &config.old_secret_keys),
            providers: Providers::load(config)?,
            max_per_device: config.max_watchers_per_device,
            allowed: (!allow_private).then_some(is_public as AddrFilter),
            worker,
        });
        if push.worker.is_some() {
            tokio::spawn(Arc::clone(&push).lease_loop());
        }
        Ok(push)
    }

    async fn lease_loop(self: Arc<Self>) {
        let Some(worker) = &self.worker else {
            return;
        };
        loop {
            self.renew_and_claim(worker).await;
            tokio::select! {
                () = tokio::time::sleep(RENEW_EVERY) => {}
                () = worker.wake.notified() => {}
            }
        }
    }

    async fn renew_and_claim(self: &Arc<Self>, worker: &Worker) {
        if worker.stopping.load(Ordering::Relaxed) {
            return;
        }
        let now = unix_now();
        let until = now + LEASE_SECS;
        match self.store.renew(&worker.id, until).await {
            Ok(held) => {
                worker.leased_until.store(until, Ordering::Relaxed);
                let held: HashSet<String> = held.into_iter().collect();
                // Unregistered, replaced, or taken by another worker after a lapse.
                worker.lock().retain(|id, task| {
                    let keep = held.contains(id);
                    if !keep {
                        task.abort();
                    }
                    keep
                });
            }
            Err(error) => {
                warn!(%error, "could not renew push leases");
                // Once the lease is over another worker may watch the same inboxes, and two
                // watchers would ping twice.
                if now >= worker.leased_until.load(Ordering::Relaxed) {
                    for (_, task) in worker.lock().drain() {
                        task.abort();
                    }
                }
                return;
            }
        }
        let watching = worker.lock().len();
        metrics::gauge!("mailbowox_push_watchers").set(u32::try_from(watching).unwrap_or(u32::MAX));
        let free = worker.capacity.saturating_sub(watching).min(CLAIM_BATCH);
        if free == 0 {
            return;
        }
        match self.store.claim(&worker.id, now, until, free).await {
            Ok(claimed) => {
                if !claimed.is_empty() {
                    info!(count = claimed.len(), "push registrations claimed");
                }
                for (id, registration, seen) in claimed {
                    self.spawn(worker, id, registration, seen);
                }
            }
            Err(error) => warn!(%error, "could not claim push registrations"),
        }
    }

    fn spawn(
        self: &Arc<Self>,
        worker: &Worker,
        id: String,
        registration: Registration,
        seen: Option<Seen>,
    ) {
        // Held across the spawn, so a watcher that stops at once cannot remove itself before
        // it is inserted.
        let mut watchers = worker.lock();
        let push = Arc::clone(self);
        let task_id = id.clone();
        let task = tokio::spawn(async move {
            let Some(worker) = &push.worker else {
                return;
            };
            let checkpoint = Saved {
                store: &push.store,
                id: &task_id,
                owner: &worker.id,
            };
            let stop = watch(
                &registration,
                &push.providers,
                &checkpoint,
                push.allowed,
                seen,
            )
            .await;
            info!(id = task_id, ?stop, "push registration dropped");
            worker.lock().remove(&task_id);
            if let Err(error) = push.store.remove_owned(&task_id, &worker.id).await {
                error!(%error, id = task_id, "could not delete the push registration");
            }
        });
        watchers.insert(id, task.abort_handle());
    }

    /// Lets this process's worker pick up a change now rather than at its next renewal.
    fn wake(&self) {
        if let Some(worker) = &self.worker {
            worker.wake.notify_one();
        }
    }

    /// Stops watching and hands the leases back, so other workers take over without waiting
    /// for them to lapse.
    pub async fn release(&self) {
        let Some(worker) = &self.worker else {
            return;
        };
        worker.stopping.store(true, Ordering::Relaxed);
        for (_, task) in worker.lock().drain() {
            task.abort();
        }
        if let Err(error) = self.store.release(&worker.id).await {
            warn!(%error, "could not release push leases");
        }
    }
}

struct Saved<'a> {
    store: &'a Store,
    id: &'a str,
    owner: &'a str,
}

impl Checkpoint for Saved<'_> {
    async fn save(&self, seen: Seen) {
        if let Err(error) = self.store.saw(self.id, self.owner, seen).await {
            warn!(%error, id = self.id, "could not record where the inbox stood");
        }
    }
}

fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(registration): Json<Registration>,
) -> Response {
    let Some(push) = &state.push else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    if !registration.platform.valid_token(&registration.token) {
        return (StatusCode::BAD_REQUEST, "bad device token").into_response();
    }
    if !push.providers.supports(registration.platform) {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    match push.store.full().await {
        Ok(false) => {}
        Ok(true) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        Err(error) => {
            error!(%error, "could not count the push registrations");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
    let config = &state.config;
    if !config.allowed_ports.contains(&registration.port) {
        return (StatusCode::FORBIDDEN, "port not allowed").into_response();
    }
    // Plain IMAP would carry the password in the clear from the gateway to the server.
    if registration.security == Security::Plain && !config.allow_private_targets {
        return (StatusCode::FORBIDDEN, "plain IMAP not allowed").into_response();
    }
    if let Err(rejection) = resolve(
        &registration.host,
        registration.port,
        config.allow_private_targets,
    )
    .await
    {
        return rejection.into_response();
    }
    // The inbox as it stands now: the first watcher pings for whatever arrives from here on.
    let seen = match MailSession::open(
        &registration.imap(),
        &registration.credentials(),
        push.allowed,
    )
    .await
    {
        Ok(session) => {
            let seen = session.unseen("INBOX").await.ok();
            let _ = session.logout().await;
            seen.map(|(state, _)| Seen::from(state))
        }
        Err(CoreError::Auth { .. }) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(error) => {
            warn!(
                error = kind(&error),
                "push registration could not reach the IMAP server"
            );
            return (StatusCode::BAD_GATEWAY, "could not reach the IMAP server").into_response();
        }
    };
    let Ok(secret) = new_secret() else {
        error!("could not draw a push registration secret");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let secret_sha256: [u8; 32] = Sha256::digest(secret.as_bytes()).into();
    match push
        .store
        .add(&registration, &secret_sha256, push.max_per_device, seen)
        .await
    {
        Ok(Some(id)) => {
            push.wake();
            (StatusCode::CREATED, Json(Registered { id, secret })).into_response()
        }
        Ok(None) => (
            StatusCode::TOO_MANY_REQUESTS,
            "too many accounts on this device",
        )
            .into_response(),
        Err(error) => {
            error!(%error, "could not save the push registration");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// The name of the error's kind. Its message can carry the server's host.
fn kind(error: &CoreError) -> &'static str {
    match error {
        CoreError::Network { .. } => "network",
        CoreError::Tls { .. } => "tls",
        CoreError::Auth { .. } => "auth",
        CoreError::Protocol { .. } => "protocol",
        CoreError::NotFound { .. } => "not found",
        CoreError::Invalid { .. } => "invalid",
        CoreError::Unconfirmed { .. } => "unconfirmed",
    }
}

pub async fn unregister(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> StatusCode {
    let Some(push) = &state.push else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    if !valid_id(&id) {
        return StatusCode::BAD_REQUEST;
    }
    let Some(secret_sha256) = bearer(&headers) else {
        return StatusCode::UNAUTHORIZED;
    };
    match push.store.remove(&id, &secret_sha256).await {
        Ok(Removal::Removed) => {
            push.wake();
            StatusCode::NO_CONTENT
        }
        Ok(Removal::Missing) => StatusCode::NOT_FOUND,
        Ok(Removal::Forbidden) => StatusCode::FORBIDDEN,
        Err(error) => {
            error!(%error, "could not delete the push registration");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}
