use mailbowox_sql::{Value, statement};

use super::{
    MailStore,
    messages::{integer, json, now, parse, text},
};
use crate::{
    error::CoreError,
    types::{Draft, DraftAttachment, OutgoingAttachment, QueuedMessage},
};

const QUEUED: &str = "SELECT id, account, queued_at, error, draft FROM outbox";

fn queued(row: &[Value]) -> Result<QueuedMessage, CoreError> {
    Ok(QueuedMessage {
        id: integer(row, 0)?,
        account: text(row, 1)?.to_owned(),
        queued_at: integer(row, 2)?,
        error: row.get(3).and_then(Value::as_str).map(str::to_owned),
        draft: parse(text(row, 4)?)?,
    })
}

fn blob(row: &[Value], column: usize) -> Option<Vec<u8>> {
    match row.get(column) {
        Some(Value::Blob(bytes)) => Some(bytes.clone()),
        _ => None,
    }
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl MailStore {
    /// Queues `draft` with its attachments, and returns its id.
    pub async fn enqueue(
        &self,
        account: String,
        draft: Draft,
        error: Option<String>,
    ) -> Result<i64, CoreError> {
        let mut statements = vec![statement!(
            "INSERT INTO outbox (account, queued_at, draft, error) VALUES (?, ?, ?, ?) RETURNING id",
            account,
            now(),
            json(&draft)?,
            error
        )];
        for (position, attachment) in draft.attachments.into_iter().enumerate() {
            statements.push(statement!(
                "INSERT INTO outbox_attachments (outbox, position, filename, mime_type, data)
                 VALUES ((SELECT MAX(id) FROM outbox), ?, ?, ?, ?)",
                i64::try_from(position).unwrap_or(i64::MAX),
                attachment.filename,
                attachment.mime_type,
                attachment.data
            ));
        }
        let rows = self.exec.batch(statements).await?;
        rows.first()
            .and_then(|rows| rows.first())
            .and_then(|row| row.first())
            .and_then(Value::as_i64)
            .ok_or_else(|| CoreError::storage("the outbox gave no id"))
    }

    pub async fn queued_messages(&self) -> Result<Vec<QueuedMessage>, CoreError> {
        let rows = self
            .rows(statement!(format!("{QUEUED} ORDER BY id")))
            .await?;
        rows.iter().map(|row| queued(row)).collect()
    }

    pub async fn queued_message(&self, id: i64) -> Result<Option<QueuedMessage>, CoreError> {
        let rows = self
            .rows(statement!(format!("{QUEUED} WHERE id = ?"), id))
            .await?;
        rows.first().map(|row| queued(row)).transpose()
    }

    pub async fn queued_attachments(&self, id: i64) -> Result<Vec<OutgoingAttachment>, CoreError> {
        let rows = self
            .rows(statement!(
                "SELECT filename, mime_type, data FROM outbox_attachments WHERE outbox = ? ORDER BY position",
                id
            ))
            .await?;
        rows.iter()
            .map(|row| {
                Ok(OutgoingAttachment {
                    filename: text(row, 0)?.to_owned(),
                    mime_type: text(row, 1)?.to_owned(),
                    data: blob(row, 2).unwrap_or_default(),
                })
            })
            .collect()
    }

    pub async fn remove_queued(&self, id: i64) -> Result<(), CoreError> {
        self.rows(statement!("DELETE FROM outbox WHERE id = ?", id))
            .await
            .map(drop)
    }

    /// The mark that keeps a message from being sent twice lands on its own, never undone with another write.
    pub async fn set_queued_error(&self, id: i64, error: Option<String>) -> Result<(), CoreError> {
        self.rows(statement!(
            "UPDATE outbox SET error = ? WHERE id = ?",
            error,
            id
        ))
        .await
        .map(drop)
    }

    pub async fn set_draft_attachments(
        &self,
        slot: String,
        attachments: Vec<DraftAttachment>,
    ) -> Result<(), CoreError> {
        let mut statements = vec![statement!(
            "DELETE FROM draft_attachments WHERE slot = ?",
            slot.as_str()
        )];
        for (position, attachment) in attachments.into_iter().enumerate() {
            statements.push(statement!(
                "INSERT INTO draft_attachments (slot, position, key, filename, mime_type, size, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
                slot.as_str(),
                i64::try_from(position).unwrap_or(i64::MAX),
                attachment.key,
                attachment.filename,
                attachment.mime_type,
                attachment.size,
                attachment.data
            ));
        }
        self.exec.batch(statements).await.map(drop)
    }

    pub async fn draft_attachments(&self, slot: String) -> Result<Vec<DraftAttachment>, CoreError> {
        let rows = self
            .rows(statement!(
                "SELECT key, filename, mime_type, size, data FROM draft_attachments WHERE slot = ? ORDER BY position",
                slot
            ))
            .await?;
        rows.iter()
            .map(|row| {
                Ok(DraftAttachment {
                    key: text(row, 0)?.to_owned(),
                    filename: text(row, 1)?.to_owned(),
                    mime_type: text(row, 2)?.to_owned(),
                    size: u64::try_from(integer(row, 3)?).map_err(CoreError::storage)?,
                    data: blob(row, 4),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::types::{Address, Draft, DraftAttachment, OutgoingAttachment};

    fn draft(attachments: Vec<OutgoingAttachment>) -> Draft {
        Draft {
            from: Address {
                name: None,
                email: "me@example.com".to_owned(),
            },
            to: vec![Address {
                name: None,
                email: "you@example.com".to_owned(),
            }],
            cc: Vec::new(),
            bcc: Vec::new(),
            subject: "Hi".to_owned(),
            text: "Hello".to_owned(),
            html: None,
            in_reply_to: None,
            references: Vec::new(),
            attachments,
        }
    }

    #[tokio::test]
    async fn a_queued_message_keeps_its_attachments_until_it_is_removed() {
        let store = super::super::tests::store().await;
        let file = OutgoingAttachment {
            filename: "a.txt".to_owned(),
            mime_type: "text/plain".to_owned(),
            data: vec![1, 2, 3],
        };
        let first = store
            .enqueue("a".to_owned(), draft(vec![file.clone()]), None)
            .await
            .unwrap();
        let second = store
            .enqueue(
                "a".to_owned(),
                draft(Vec::new()),
                Some("refused".to_owned()),
            )
            .await
            .unwrap();
        assert!(second > first, "{second} after {first}");

        let queued = store.queued_messages().await.unwrap();
        assert_eq!(
            queued.iter().map(|m| m.id).collect::<Vec<_>>(),
            [first, second]
        );
        assert_eq!(queued[0].draft, draft(Vec::new()));
        assert_eq!(queued[1].error.as_deref(), Some("refused"));
        assert_eq!(store.queued_attachments(first).await.unwrap(), [file]);

        store
            .set_queued_error(first, Some("unconfirmed".to_owned()))
            .await
            .unwrap();
        assert_eq!(
            store
                .queued_message(first)
                .await
                .unwrap()
                .and_then(|m| m.error)
                .as_deref(),
            Some("unconfirmed")
        );
        store.remove_queued(first).await.unwrap();
        assert_eq!(store.queued_message(first).await.unwrap(), None);
        assert_eq!(store.queued_attachments(first).await.unwrap(), []);
    }

    #[tokio::test]
    async fn a_draft_slot_keeps_attachments_still_downloading_without_data() {
        let store = super::super::tests::store().await;
        let kept = DraftAttachment {
            key: "k1".to_owned(),
            filename: "a.pdf".to_owned(),
            mime_type: "application/pdf".to_owned(),
            size: 3,
            data: Some(vec![7, 8, 9]),
        };
        let pending = DraftAttachment {
            key: "k2".to_owned(),
            data: None,
            ..kept.clone()
        };
        store
            .set_draft_attachments("slot".to_owned(), vec![kept.clone(), pending.clone()])
            .await
            .unwrap();
        assert_eq!(
            store.draft_attachments("slot".to_owned()).await.unwrap(),
            [kept, pending]
        );
        store
            .set_draft_attachments("slot".to_owned(), Vec::new())
            .await
            .unwrap();
        assert_eq!(
            store.draft_attachments("slot".to_owned()).await.unwrap(),
            []
        );
    }
}
