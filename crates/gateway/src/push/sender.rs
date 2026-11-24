//! What reaches APNs and FCM: a hash of the account address and its unread count, plus an
//! encrypted preview.

use std::time::Duration;

use push_delivery::apns_h2::request::notification::{
    DefaultNotificationBuilder, NotificationBuilder, NotificationOptions, Priority, PushType,
};
use push_delivery::apns_h2::request::payload::Payload;
use push_delivery::{Apns, Fcm, Outcome};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::Platform;
use super::watcher::{Delivery, Notify};
use crate::config::PushConfig;

const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Ping {
    pub account: String,
    pub unread: u32,
}

/// The app finds the account by hashing its own lowercased address the same way.
pub fn ping(email: &str, unread: u32) -> Ping {
    Ping {
        account: hex::encode(Sha256::digest(email.trim().to_lowercase().as_bytes())),
        unread,
    }
}

/// A fixed alert, so iOS shows something even when the app is not running; `content-available`
/// also wakes the app to sync. expo-notifications reads custom data from the `body` key.
fn apns_payload<'a>(
    token: &'a str,
    topic: &'a str,
    ping: &Ping,
    preview: Option<&str>,
) -> Payload<'a> {
    let options = NotificationOptions {
        apns_topic: Some(topic),
        apns_push_type: Some(PushType::Alert),
        apns_priority: Some(Priority::High),
        ..Default::default()
    };
    let mut builder = DefaultNotificationBuilder::new()
        .body("New mail")
        .sound("default")
        .content_available();
    if preview.is_some() {
        builder = builder.mutable_content();
    }
    let mut payload = builder.build(token, options);
    payload.data.insert("body".into(), json!(ping));
    if let Some(preview) = preview {
        payload.data.insert("m".into(), json!(preview));
    }
    payload
}

/// Android gets a data-only message; the app's background task shows the notification.
fn fcm_message(token: &str, ping: &Ping, preview: Option<&str>) -> Value {
    let mut data = json!({ "body": json!(ping).to_string() });
    if let Some(preview) = preview {
        data["m"] = json!(preview);
    }
    json!({
        "message": {
            "token": token,
            "data": data,
            "android": { "priority": "high" },
        }
    })
}

impl From<Outcome> for Delivery {
    fn from(outcome: Outcome) -> Self {
        match outcome {
            Outcome::Delivered => Self::Sent,
            Outcome::Gone => Self::Gone,
            Outcome::RateLimited | Outcome::Failed => Self::Failed,
        }
    }
}

pub struct Providers {
    apns: Option<Apns>,
    fcm: Option<Fcm>,
}

impl Providers {
    pub fn load(config: &PushConfig) -> Result<Self, Box<dyn std::error::Error>> {
        let apns = match &config.apns {
            Some(apns) => Some(Apns::new(
                &std::fs::read(&apns.key_file)?,
                &apns.key_id,
                &apns.team_id,
                &apns.topic,
                TIMEOUT,
            )?),
            None => None,
        };
        let fcm = match &config.fcm_credentials_file {
            Some(file) => Some(Fcm::from_file(file, TIMEOUT)?),
            None => None,
        };
        Ok(Self { apns, fcm })
    }

    pub fn supports(&self, platform: Platform) -> bool {
        match platform {
            Platform::Ios | Platform::IosSandbox => self.apns.is_some(),
            Platform::Android => self.fcm.is_some(),
        }
    }
}

impl Notify for Providers {
    async fn notify(
        &self,
        platform: Platform,
        token: &str,
        ping: &Ping,
        preview: Option<&str>,
    ) -> Delivery {
        let outcome = match (platform, &self.apns, &self.fcm) {
            (Platform::Ios | Platform::IosSandbox, Some(apns), _) => {
                let payload = apns_payload(token, apns.topic(), ping, preview);
                apns.send(platform == Platform::IosSandbox, payload).await
            }
            (Platform::Android, _, Some(fcm)) => fcm.send(&fcm_message(token, ping, preview)).await,
            _ => Outcome::Failed,
        };
        outcome.into()
    }
}

#[cfg(test)]
mod tests {
    use push_delivery::apns_h2::request::payload::PayloadLike;

    use super::*;

    fn keys(value: &Value) -> Vec<&str> {
        value
            .as_object()
            .map_or_default(|object| object.keys().map(String::as_str).collect())
    }

    #[test]
    fn ping_names_the_account_by_hash_only() {
        let ping = ping(" Alice@Example.org ", 3);
        assert_eq!(
            ping.account,
            hex::encode(Sha256::digest(b"alice@example.org"))
        );
        assert_eq!(keys(&json!(ping)), ["account", "unread"]);
    }

    #[test]
    fn apns_payload_carries_a_fixed_alert_and_the_ping() {
        let ping = ping("alice@example.org", 2);
        let payload = apns_payload("abcd", "eu.owops.mailbowox", &ping, None);
        assert_eq!(payload.device_token, "abcd");
        assert_eq!(payload.options.apns_topic, Some("eu.owops.mailbowox"));
        assert!(matches!(
            payload.options.apns_push_type,
            Some(PushType::Alert)
        ));
        assert!(matches!(
            payload.options.apns_priority,
            Some(Priority::High)
        ));
        let json: Value = serde_json::from_str(&payload.to_json_string().unwrap()).unwrap();
        assert_eq!(keys(&json), ["aps", "body"]);
        assert_eq!(json["aps"]["alert"]["body"], "New mail");
        assert_eq!(json["aps"]["sound"], "default");
        assert_eq!(json["aps"]["content-available"], 1);
        assert_eq!(
            json["body"],
            json!({ "account": ping.account, "unread": 2 })
        );
        assert_eq!(json["aps"]["mutable-content"], 0);
        assert!(!json.to_string().contains("alice"));
    }

    #[test]
    fn a_sealed_preview_goes_to_the_extension() {
        let ping = ping("alice@example.org", 2);
        let payload = apns_payload("abcd", "eu.owops.mailbowox", &ping, Some("c2VhbGVk"));
        let json: Value = serde_json::from_str(&payload.to_json_string().unwrap()).unwrap();
        assert_eq!(keys(&json), ["aps", "body", "m"]);
        assert_eq!(json["m"], "c2VhbGVk");
        assert_eq!(json["aps"]["mutable-content"], 1);
        assert_eq!(json["aps"]["alert"]["body"], "New mail");
    }

    #[test]
    fn fcm_message_is_data_only_with_the_ping() {
        let ping = ping("alice@example.org", 7);
        let message = fcm_message("tok", &ping, None);
        assert_eq!(keys(&message["message"]), ["android", "data", "token"]);
        assert_eq!(keys(&message["message"]["data"]), ["body"]);
        let body: Value =
            serde_json::from_str(message["message"]["data"]["body"].as_str().unwrap()).unwrap();
        assert_eq!(body, json!({ "account": ping.account, "unread": 7 }));
        assert!(!message.to_string().contains("alice"));
    }

    #[test]
    fn a_sealed_preview_goes_to_the_android_app() {
        let ping = ping("alice@example.org", 7);
        let message = fcm_message("tok", &ping, Some("c2VhbGVk"));
        assert_eq!(keys(&message["message"]["data"]), ["body", "m"]);
        assert_eq!(message["message"]["data"]["m"], "c2VhbGVk");
        assert!(message["message"].get("notification").is_none());
    }

    #[test]
    fn only_dead_tokens_are_gone() {
        assert_eq!(Delivery::from(Outcome::Delivered), Delivery::Sent);
        assert_eq!(Delivery::from(Outcome::Gone), Delivery::Gone);
        assert_eq!(Delivery::from(Outcome::RateLimited), Delivery::Failed);
        assert_eq!(Delivery::from(Outcome::Failed), Delivery::Failed);
    }
}
