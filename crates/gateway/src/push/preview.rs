//! The newest message's sender, subject and preview, encrypted to the device (RFC 8291).

use aes_gcm::aead::Aead;
use aes_gcm::{Aes128Gcm, KeyInit};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hkdf::Hkdf;
use mailbowox_core::MessageSummary;
use p256::elliptic_curve::sec1::ToSec1Point;
use p256::{PublicKey, SecretKey};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;

/// APNs takes 4 KB. Escaped JSON can outgrow the text caps, hence `SEALED_BYTES`.
const SENDER_BYTES: usize = 128;
const SUBJECT_BYTES: usize = 256;
const PREVIEW_BYTES: usize = 512;
const SEALED_BYTES: usize = 3072;

const RECORD_SIZE: u32 = 4096;

/// base64url, unpadded.
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct DeviceKeys {
    pub p256dh: String,
    pub auth: String,
}

impl DeviceKeys {
    pub(crate) fn valid(&self) -> bool {
        self.parse().is_some()
    }

    fn parse(&self) -> Option<(PublicKey, [u8; 16])> {
        let public = URL_SAFE_NO_PAD.decode(&self.p256dh).ok()?;
        let auth = URL_SAFE_NO_PAD.decode(&self.auth).ok()?.try_into().ok()?;
        if public.len() != 65 {
            return None;
        }
        Some((PublicKey::from_sec1_bytes(&public).ok()?, auth))
    }
}

pub(super) fn seal(keys: &DeviceKeys, message: &MessageSummary) -> Option<String> {
    let (public, auth) = keys.parse()?;
    let sender = message
        .from
        .first()
        .map_or_default(|from| from.name.clone().unwrap_or_else(|| from.email.clone()));
    let content = json!({
        "title": truncate(&sender, SENDER_BYTES),
        "subtitle": truncate(&message.subject, SUBJECT_BYTES),
        "body": truncate(&message.preview, PREVIEW_BYTES),
    });
    let mut ephemeral = [0; 32];
    let mut salt = [0; 16];
    getrandom::fill(&mut ephemeral).ok()?;
    getrandom::fill(&mut salt).ok()?;
    let ephemeral = SecretKey::from_slice(&ephemeral).ok()?;
    let sealed = encrypt(
        content.to_string().as_bytes(),
        &public,
        &auth,
        &ephemeral,
        salt,
    );
    let sealed = URL_SAFE_NO_PAD.encode(sealed);
    (sealed.len() <= SEALED_BYTES).then_some(sealed)
}

/// One `aes128gcm` record (RFC 8188).
#[expect(
    clippy::expect_used,
    reason = "HKDF-SHA256 gives up to 8160 bytes and AES-GCM takes messages up to 64 GB"
)]
fn encrypt(
    plain: &[u8],
    device: &PublicKey,
    auth: &[u8; 16],
    server: &SecretKey,
    salt: [u8; 16],
) -> Vec<u8> {
    let device_point = device.to_sec1_point(false);
    let server_point = server.public_key().to_sec1_point(false);
    let shared = server.diffie_hellman(device);

    let info = [
        b"WebPush: info\0".as_slice(),
        device_point.as_bytes(),
        server_point.as_bytes(),
    ]
    .concat();
    let mut ikm = [0; 32];
    Hkdf::<Sha256>::new(Some(auth), shared.raw_secret_bytes())
        .expand(&info, &mut ikm)
        .expect("HKDF-SHA256 gives up to 8160 bytes");
    let prk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let mut cek = [0; 16];
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
        .expect("HKDF-SHA256 gives up to 8160 bytes");
    let mut nonce = [0; 12];
    prk.expand(b"Content-Encoding: nonce\0", &mut nonce)
        .expect("HKDF-SHA256 gives up to 8160 bytes");

    let padded = [plain, &[2]].concat();
    let ciphertext = Aes128Gcm::new(&cek.into())
        .encrypt(&nonce.into(), padded.as_slice())
        .expect("AES-GCM takes messages up to 64 GB");

    [
        salt.as_slice(),
        &RECORD_SIZE.to_be_bytes(),
        &[65],
        server_point.as_bytes(),
        &ciphertext,
    ]
    .concat()
}

fn truncate(text: &str, max: usize) -> &str {
    text.get(..text.floor_char_boundary(max)).unwrap_or(text)
}

#[cfg(test)]
pub(super) mod tests {
    use mailbowox_core::{Address, Flags};
    use serde_json::Value;

    use super::*;

    fn b64(value: &str) -> Vec<u8> {
        URL_SAFE_NO_PAD.decode(value).unwrap()
    }

    pub(in crate::push) fn open(secret: &SecretKey, auth: &[u8; 16], sealed: &str) -> Value {
        let body = b64(sealed);
        let (salt, rest) = body.split_at(16);
        let (key, ciphertext) = rest[5..].split_at(usize::from(rest[4]));
        let server = PublicKey::from_sec1_bytes(key).unwrap();
        let device = secret.public_key().to_sec1_point(false);
        let info = [b"WebPush: info\0".as_slice(), device.as_bytes(), key].concat();
        let mut ikm = [0; 32];
        Hkdf::<Sha256>::new(
            Some(auth),
            secret.diffie_hellman(&server).raw_secret_bytes(),
        )
        .expand(&info, &mut ikm)
        .unwrap();
        let prk = Hkdf::<Sha256>::new(Some(salt), &ikm);
        let mut cek = [0; 16];
        prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
            .unwrap();
        let mut nonce = [0; 12];
        prk.expand(b"Content-Encoding: nonce\0", &mut nonce)
            .unwrap();
        let mut plain = Aes128Gcm::new_from_slice(&cek)
            .unwrap()
            .decrypt(&nonce.into(), ciphertext)
            .unwrap();
        assert_eq!(plain.pop(), Some(2));
        serde_json::from_slice(&plain).unwrap()
    }

    pub(in crate::push) fn device() -> (SecretKey, [u8; 16], DeviceKeys) {
        let secret = SecretKey::from_slice(&[7; 32]).unwrap();
        let auth = [9; 16];
        let keys = DeviceKeys {
            p256dh: URL_SAFE_NO_PAD.encode(secret.public_key().to_sec1_point(false).as_bytes()),
            auth: URL_SAFE_NO_PAD.encode(auth),
        };
        (secret, auth, keys)
    }

    fn message(name: Option<&str>, subject: &str, preview: &str) -> MessageSummary {
        MessageSummary {
            uid: 1,
            flags: Flags::default(),
            subject: subject.into(),
            from: vec![Address {
                name: name.map(Into::into),
                email: "bob@example.org".into(),
            }],
            to: Vec::new(),
            cc: Vec::new(),
            reply_to: Vec::new(),
            delivered_to: Vec::new(),
            date: 0,
            message_id: None,
            in_reply_to: None,
            references: Vec::new(),
            preview: preview.into(),
            has_attachments: false,
            size: 0,

            category: mailbowox_core::Category::Primary,
        }
    }

    #[test]
    fn encrypts_the_rfc_8291_example() {
        let device = PublicKey::from_sec1_bytes(&b64(
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        ))
        .unwrap();
        let auth = b64("BTBZMqHH6r4Tts7J_aSIgg").try_into().unwrap();
        let server =
            SecretKey::from_slice(&b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")).unwrap();
        let salt = b64("DGv6ra1nlYgDCS1FRnbzlw").try_into().unwrap();
        let sealed = encrypt(
            b"When I grow up, I want to be a watermelon",
            &device,
            &auth,
            &server,
            salt,
        );
        assert_eq!(
            URL_SAFE_NO_PAD.encode(sealed),
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
        );
    }

    #[test]
    fn only_the_device_reads_the_sender_subject_and_preview() {
        let (secret, auth, keys) = device();
        let sealed = seal(&keys, &message(Some("Bob"), "Lunch?", "At noon.")).unwrap();
        assert_ne!(
            sealed,
            seal(&keys, &message(Some("Bob"), "Lunch?", "At noon.")).unwrap()
        );
        assert_eq!(
            open(&secret, &auth, &sealed),
            json!({ "title": "Bob", "subtitle": "Lunch?", "body": "At noon." })
        );
    }

    #[test]
    fn a_sender_without_a_name_is_shown_by_address() {
        let (secret, auth, keys) = device();
        let sealed = seal(&keys, &message(None, "", "")).unwrap();
        assert_eq!(open(&secret, &auth, &sealed)["title"], "bob@example.org");
    }

    #[test]
    fn long_text_is_cut_on_a_character_boundary() {
        let (secret, auth, keys) = device();
        let long = "é".repeat(1000);
        let sealed = seal(&keys, &message(Some(&long), &long, &long)).unwrap();
        let content = open(&secret, &auth, &sealed);
        assert_eq!(content["title"].as_str().unwrap().len(), SENDER_BYTES);
        assert_eq!(content["subtitle"].as_str().unwrap().len(), SUBJECT_BYTES);
        assert_eq!(content["body"].as_str().unwrap().len(), PREVIEW_BYTES);
        assert!(sealed.len() < 2048);
    }

    #[test]
    fn a_preview_that_escapes_past_the_cap_is_dropped() {
        let (_, _, keys) = device();
        let control = "\u{1}".repeat(1000);
        assert_eq!(
            seal(&keys, &message(Some(&control), &control, &control)),
            None
        );
    }

    #[test]
    fn malformed_keys_are_refused() {
        let (_, _, keys) = device();
        assert!(keys.valid());
        let short = DeviceKeys {
            auth: URL_SAFE_NO_PAD.encode([1; 8]),
            ..keys.clone()
        };
        assert!(!short.valid());
        let off_curve = DeviceKeys {
            p256dh: URL_SAFE_NO_PAD.encode([4; 65]),
            ..keys
        };
        assert!(!off_curve.valid());
    }
}
