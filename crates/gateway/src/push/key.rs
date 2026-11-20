//! One push secret key: it seals registrations and hashes what their rows are found by.

use chacha20poly1305::aead::{Aead, Generate, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use super::Registration;
use super::store::Error;

const NONCE_BYTES: usize = 24;

pub(super) struct Key {
    pub(super) id: String,
    cipher: XChaCha20Poly1305,
    index_secret: [u8; 32],
}

impl Key {
    pub(super) fn new(key: &[u8; 32]) -> Self {
        let hkdf = Hkdf::<Sha256>::new(None, key);
        let mut id = [0; 4];
        let mut index_secret = [0; 32];
        hkdf.expand(b"mailbowox push key id", &mut id)
            .expect("HKDF-SHA256 gives up to 8160 bytes");
        hkdf.expand(b"mailbowox push index", &mut index_secret)
            .expect("HKDF-SHA256 gives up to 8160 bytes");
        Self {
            id: hex::encode(id),
            cipher: XChaCha20Poly1305::new(key.into()),
            index_secret,
        }
    }

    pub(super) fn index(&self, parts: &[&[u8]]) -> String {
        let mut mac = <Hmac<Sha256>>::new_from_slice(&self.index_secret)
            .expect("HMAC takes keys of any length");
        for part in parts {
            mac.update(part);
            mac.update(&[0]);
        }
        hex::encode(mac.finalize().into_bytes())
    }

    pub(super) fn seal(&self, id: &str, registration: &Registration) -> Result<Vec<u8>, Error> {
        let plaintext = serde_json::to_vec(registration)?;
        let nonce = XNonce::generate();
        let sealed = self
            .cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &plaintext,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| "could not encrypt the registration")?;
        Ok([nonce.as_slice(), &sealed].concat())
    }

    pub(super) fn open(&self, id: &str, bytes: &[u8]) -> Option<Registration> {
        let (nonce, sealed) = bytes.split_at_checked(NONCE_BYTES)?;
        let nonce = XNonce::try_from(nonce).ok()?;
        let plaintext = self
            .cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: sealed,
                    aad: id.as_bytes(),
                },
            )
            .ok()?;
        serde_json::from_slice(&plaintext).ok()
    }
}
