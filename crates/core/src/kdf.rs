use argon2::{Algorithm, Argon2, Params, Version};
use unicode_normalization::UnicodeNormalization;

use crate::CoreError;

/// The 32-byte key a password seals the vault slot and account backups
/// with: argon2id over the NFC-normalized password.
#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn password_key(password: String, salt: Vec<u8>) -> Result<Vec<u8>, CoreError> {
    let derive = move || {
        // OWASP's argon2id baseline (19 MiB, 2 passes). Existing vault slots and backups were sealed with these
        // exact parameters, so changing them locks people out.
        let params = Params::new(19 * 1024, 2, 1, None).map_err(CoreError::invalid)?;
        let mut key = vec![0; 32];
        Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
            .hash_password_into(
                password.nfc().collect::<String>().as_bytes(),
                &salt,
                &mut key,
            )
            .map_err(CoreError::invalid)?;
        Ok(key)
    };
    #[cfg(not(target_arch = "wasm32"))]
    return tokio::task::spawn_blocking(derive)
        .await
        .map_err(CoreError::invalid)?;
    #[cfg(target_arch = "wasm32")]
    derive()
}

#[cfg(test)]
mod tests {
    use super::password_key;

    async fn hex_key(password: &str) -> Option<String> {
        let key = password_key(password.to_owned(), (0..16).collect())
            .await
            .ok()?;
        Some(
            key.iter()
                .fold(String::new(), |hex, byte| hex + &format!("{byte:02x}")),
        )
    }

    // Derived by @noble/hashes' argon2id, which sealed every vault slot and backup before the core took over.
    #[tokio::test]
    async fn derives_the_keys_the_javascript_build_did() {
        assert_eq!(
            hex_key("correct horse battery").await.as_deref(),
            Some("aaecaeb1f79eb8019ba62c34f62fa3e15289f88ff98779ae81de07821992ff1f")
        );
    }

    #[tokio::test]
    async fn normalizes_the_password_first() {
        for password in ["\u{e9}t\u{e9}", "e\u{301}te\u{301}"] {
            assert_eq!(
                hex_key(password).await.as_deref(),
                Some("ecd8bdc237a4ce0a6cf2a853f4b546c3bb7f380c72f2d1870dc27fd0421318e0")
            );
        }
    }
}
