use mailbowox_sql::{Value, statement};

use super::{
    MailStore,
    messages::{integer, now},
};
use crate::{error::CoreError, types::Avatar};

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl MailStore {
    pub async fn avatar(&self, email: String) -> Result<Option<Avatar>, CoreError> {
        let rows = self
            .rows(statement!(
                "SELECT source, checked_at FROM avatars WHERE email = ?",
                email.to_lowercase()
            ))
            .await?;
        rows.first()
            .map(|row| {
                Ok(Avatar {
                    source: row.first().and_then(Value::as_str).map(str::to_owned),
                    checked_at: integer(row, 1)?,
                })
            })
            .transpose()
    }

    pub async fn set_avatar(&self, email: String, source: Option<String>) -> Result<(), CoreError> {
        self.rows(statement!(
            "INSERT OR REPLACE INTO avatars (email, source, checked_at) VALUES (?, ?, ?)",
            email.to_lowercase(),
            source,
            now()
        ))
        .await
        .map(drop)
    }
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn keeps_where_a_picture_was_found_and_where_none_was() {
        let store = super::super::tests::store().await;
        assert_eq!(
            store.avatar("Bob@Example.com".to_owned()).await.unwrap(),
            None
        );
        store
            .set_avatar(
                "Bob@Example.com".to_owned(),
                Some("https://gravatar.com/avatar/x".to_owned()),
            )
            .await
            .unwrap();
        store
            .set_avatar("shop@example.com".to_owned(), None)
            .await
            .unwrap();
        let bob = store
            .avatar("bob@example.com".to_owned())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(bob.source.as_deref(), Some("https://gravatar.com/avatar/x"));
        assert!(bob.checked_at > 0, "{bob:?}");
        assert_eq!(
            store
                .avatar("shop@example.com".to_owned())
                .await
                .unwrap()
                .map(|a| a.source),
            Some(None)
        );
    }
}
