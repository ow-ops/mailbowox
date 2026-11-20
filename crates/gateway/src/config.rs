use std::env;
use std::path::PathBuf;
use std::time::Duration;

use axum::http::HeaderValue;

const DEFAULT_PORTS: &str = "993,465,587,143,443";

pub struct Config {
    pub roles: Roles,
    /// `sqlite://…` or `postgres://…`; gateways share push work only through Postgres.
    pub database_url: String,
    pub tokens: Vec<String>,
    pub allowed_ports: Vec<u16>,
    pub allow_private_targets: bool,
    /// Rate limit by the client named in `X-Forwarded-For` rather than the peer address. Only
    /// behind a proxy that sets it, or clients choose their own limit.
    pub trust_proxy: bool,
    pub allowed_origins: Vec<HeaderValue>,
    pub max_connections_per_token: usize,
    pub idle_timeout: Duration,
    /// `None` without `PUSH_SECRET_KEY`: `/push` then answers 503.
    pub push: Option<PushConfig>,
}

#[derive(Clone, Copy)]
pub struct Roles {
    /// `/vault`, `/link` and `/push` registrations.
    pub api: bool,
    pub relay: bool,
    /// The IMAP IDLE watchers.
    pub push: bool,
}

impl Roles {
    pub const ALL: Self = Self {
        api: true,
        relay: true,
        push: true,
    };

    fn parse(list: &[String]) -> Result<Self, String> {
        if list.is_empty() {
            return Ok(Self::ALL);
        }
        let mut roles = Self {
            api: false,
            relay: false,
            push: false,
        };
        for role in list {
            match role.as_str() {
                "api" => roles.api = true,
                "relay" => roles.relay = true,
                "push" => roles.push = true,
                other => {
                    return Err(format!(
                        "unknown role {other:?}, expected api, relay or push"
                    ));
                }
            }
        }
        Ok(roles)
    }
}

pub struct PushConfig {
    pub secret_key: [u8; 32],
    pub old_secret_keys: Vec<[u8; 32]>,
    /// The most inboxes one gateway watches.
    pub capacity: usize,
    pub apns: Option<ApnsConfig>,
    pub fcm_credentials_file: Option<PathBuf>,
    pub max_watchers_per_device: usize,
}

pub struct ApnsConfig {
    pub key_file: PathBuf,
    pub key_id: String,
    pub team_id: String,
    pub topic: String,
}

impl Config {
    /// # Errors
    ///
    /// Returns a message when a port, origin or push setting can't be parsed.
    pub fn from_env() -> Result<Self, String> {
        let list = |name: &str| -> Vec<String> {
            env::var(name)
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_owned)
                .collect()
        };
        let ports = env::var("ALLOWED_PORTS").unwrap_or_else(|_| DEFAULT_PORTS.to_owned());
        let allowed_ports = ports
            .split(',')
            .map(|port| {
                port.trim()
                    .parse()
                    .map_err(|_| format!("bad port {port:?}"))
            })
            .collect::<Result<_, _>>()?;
        let allowed_origins = list("ALLOWED_ORIGINS")
            .iter()
            .map(|origin| {
                HeaderValue::from_str(origin).map_err(|_| format!("bad origin {origin:?}"))
            })
            .collect::<Result<_, _>>()?;
        Ok(Self {
            roles: Roles::parse(&list("ROLES"))?,
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite://gateway.db?mode=rwc".to_owned()),
            tokens: list("GATEWAY_TOKENS"),
            allowed_ports,
            allow_private_targets: env::var("ALLOW_PRIVATE_TARGETS").is_ok_and(|v| v == "1"),
            trust_proxy: env::var("TRUST_PROXY").is_ok_and(|v| v == "1"),
            allowed_origins,
            max_connections_per_token: 32,
            idle_timeout: Duration::from_mins(30),
            push: push_from_env()?,
        })
    }
}

fn env_var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.is_empty())
}

fn parse_key(hex: &str) -> Option<[u8; 32]> {
    hex::decode(hex.trim()).ok()?.try_into().ok()
}

fn push_from_env() -> Result<Option<PushConfig>, String> {
    let Some(key) = env_var("PUSH_SECRET_KEY") else {
        return Ok(None);
    };
    let secret_key = parse_key(&key).ok_or("PUSH_SECRET_KEY must be 64 hex characters")?;
    let old_secret_keys = env_var("PUSH_OLD_SECRET_KEYS")
        .iter()
        .flat_map(|keys| keys.split(','))
        .map(|key| parse_key(key).ok_or("PUSH_OLD_SECRET_KEYS must be 64 hex characters each"))
        .collect::<Result<_, _>>()?;
    let apns = match env_var("APNS_KEY_FILE") {
        Some(key_file) => Some(ApnsConfig {
            key_file: key_file.into(),
            key_id: env_var("APNS_KEY_ID").ok_or("APNS_KEY_ID is required with APNS_KEY_FILE")?,
            team_id: env_var("APNS_TEAM_ID")
                .ok_or("APNS_TEAM_ID is required with APNS_KEY_FILE")?,
            topic: env_var("APNS_TOPIC").unwrap_or_else(|| "eu.owops.mailbowox".to_owned()),
        }),
        None => None,
    };
    let capacity = match env_var("PUSH_CAPACITY") {
        Some(value) => value
            .parse()
            .map_err(|_| format!("bad PUSH_CAPACITY {value:?}"))?,
        None => 10_000,
    };
    Ok(Some(PushConfig {
        secret_key,
        old_secret_keys,
        capacity,
        apns,
        fcm_credentials_file: env_var("FCM_CREDENTIALS_FILE").map(PathBuf::from),
        max_watchers_per_device: 10,
    }))
}
