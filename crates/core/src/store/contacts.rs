use mailbowox_sql::{Statement, Value, statement};

use super::{
    MailStore,
    messages::{integer, json, parse, text},
    search::normalize,
};
use crate::{
    carddav,
    error::CoreError,
    types::{
        AccountConfig, AddressBook, Contact, ContactAddress, ContactRow, ContactSyncResult,
        ContactSyncState, ContactTag, ContactValue, StoredAddressBook, StoredContact,
    },
};

fn optional(row: &[Value], column: usize) -> Option<String> {
    row.get(column).and_then(Value::as_str).map(str::to_owned)
}

fn sort_key(contact: &Contact) -> String {
    let family_given = [contact.family.as_deref(), contact.given.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    let key = family_given.trim();
    normalize(if key.is_empty() { &contact.name } else { key })
}

fn search_text(contact: &Contact) -> String {
    let words: Vec<&str> = [contact.name.as_str()]
        .into_iter()
        .chain(contact.organization.as_deref())
        .chain(contact.emails.iter().map(|email| email.value.as_str()))
        .chain(contact.phones.iter().map(|phone| phone.value.as_str()))
        .filter(|word| !word.is_empty())
        .collect();
    normalize(&words.join("\n"))
}

fn upsert(account: &str, book: &str, contact: &Contact) -> Result<Statement, CoreError> {
    Ok(statement!(
        "INSERT OR REPLACE INTO contacts (account, href, book, uid, etag, name, given, family, organization, emails, phones,
           photo, vcard, sort, search)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        account,
        contact.href.as_str(),
        book,
        contact.uid.as_str(),
        contact.etag.clone(),
        contact.name.as_str(),
        contact.given.clone(),
        contact.family.clone(),
        contact.organization.clone(),
        json(&contact.emails)?,
        json(&contact.phones)?,
        contact.photo.clone(),
        contact.vcard.as_str(),
        sort_key(contact),
        search_text(contact)
    ))
}

fn emails(row: &[Value], column: usize) -> Result<Vec<ContactValue>, CoreError> {
    parse(text(row, column)?)
}

impl MailStore {
    /// The server's ctag and sync token describe the server; ours describe
    /// what was last synced, so a book listed again keeps them.
    async fn save_address_books(
        &self,
        account: &str,
        books: &[AddressBook],
    ) -> Result<(), CoreError> {
        let hrefs = json(
            &books
                .iter()
                .map(|book| book.href.as_str())
                .collect::<Vec<_>>(),
        )?;
        let mut statements = vec![
            statement!(
                "DELETE FROM contacts WHERE account = ? AND book NOT IN (SELECT value FROM json_each(?))",
                account,
                hrefs.as_str()
            ),
            statement!(
                "DELETE FROM address_books WHERE account = ? AND href NOT IN (SELECT value FROM json_each(?))",
                account,
                hrefs
            ),
        ];
        for (position, book) in books.iter().enumerate() {
            statements.push(statement!(
                "INSERT INTO address_books (account, href, position, name, read_only) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (account, href) DO UPDATE SET
                   position = excluded.position, name = excluded.name, read_only = excluded.read_only",
                account,
                book.href.as_str(),
                i64::try_from(position).unwrap_or(i64::MAX),
                book.name.as_str(),
                i64::from(book.read_only)
            ));
        }
        self.exec.batch(statements).await.map(drop)
    }

    async fn sync_input(
        &self,
        account: &str,
        book: &str,
    ) -> Result<(Option<ContactSyncState>, Vec<ContactTag>), CoreError> {
        let rows = self
            .exec
            .batch(vec![
                statement!(
                    "SELECT ctag, sync_token FROM address_books WHERE account = ? AND href = ?",
                    account,
                    book
                ),
                statement!(
                    "SELECT href, etag FROM contacts WHERE account = ? AND book = ? AND etag IS NOT NULL",
                    account,
                    book
                ),
            ])
            .await?;
        let [state, known] = super::messages::answers(rows)?;
        let state = state
            .first()
            .map(|row| ContactSyncState {
                ctag: optional(row, 0),
                sync_token: optional(row, 1),
            })
            .filter(|state| state.ctag.is_some() || state.sync_token.is_some());
        let known = known
            .iter()
            .map(|row| {
                Ok(ContactTag {
                    href: text(row, 0)?.to_owned(),
                    etag: text(row, 1)?.to_owned(),
                })
            })
            .collect::<Result<_, CoreError>>()?;
        Ok((state, known))
    }

    async fn apply_contact_sync(
        &self,
        account: &str,
        book: &str,
        result: &ContactSyncResult,
    ) -> Result<(), CoreError> {
        let mut statements = Vec::new();
        if result.reset {
            statements.push(statement!(
                "DELETE FROM contacts WHERE account = ? AND book = ?",
                account,
                book
            ));
        }
        for href in &result.removed {
            statements.push(statement!(
                "DELETE FROM contacts WHERE account = ? AND href = ?",
                account,
                href.as_str()
            ));
        }
        for contact in &result.changed {
            statements.push(upsert(account, book, contact)?);
        }
        statements.push(statement!(
            "UPDATE address_books SET ctag = ?, sync_token = ? WHERE account = ? AND href = ?",
            result.state.ctag.clone(),
            result.state.sync_token.clone(),
            account,
            book
        ));
        self.exec.batch(statements).await.map(drop)
    }
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl MailStore {
    /// Lists the account's address books at `home` and syncs each, one at a
    /// time: servers such as Stalwart cap concurrent requests per account. A
    /// book that fails doesn't stop the others; the first failure is returned.
    pub async fn sync_contacts(
        &self,
        config: AccountConfig,
        account: String,
        home: String,
    ) -> Result<(), CoreError> {
        let books = carddav::list(&config, &home).await?;
        self.save_address_books(&account, &books).await?;
        let mut failure = None;
        for book in &books {
            let synced = async {
                let (state, known) = self.sync_input(&account, &book.href).await?;
                let result = carddav::sync(&config, &book.href, state, &known).await?;
                self.apply_contact_sync(&account, &book.href, &result).await
            };
            if let Err(error) = synced.await {
                failure.get_or_insert(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }

    pub async fn address_books(&self) -> Result<Vec<StoredAddressBook>, CoreError> {
        let rows = self
            .rows(statement!(
                "SELECT account, href, name, read_only, ctag, sync_token FROM address_books ORDER BY account, position"
            ))
            .await?;
        rows.iter()
            .map(|row| {
                Ok(StoredAddressBook {
                    account: text(row, 0)?.to_owned(),
                    book: AddressBook {
                        href: text(row, 1)?.to_owned(),
                        name: text(row, 2)?.to_owned(),
                        read_only: integer(row, 3)? != 0,
                        ctag: optional(row, 4),
                        sync_token: optional(row, 5),
                    },
                })
            })
            .collect()
    }

    /// After a contact was saved on the server.
    pub async fn put_contact(
        &self,
        account: String,
        book: String,
        contact: Contact,
    ) -> Result<(), CoreError> {
        self.rows(upsert(&account, &book, &contact)?)
            .await
            .map(drop)
    }

    pub async fn remove_contact(&self, account: String, href: String) -> Result<(), CoreError> {
        self.rows(statement!(
            "DELETE FROM contacts WHERE account = ? AND href = ?",
            account,
            href
        ))
        .await
        .map(drop)
    }

    /// Sorted by family name, then given name. Every word has to appear in
    /// the name, company, an address or a number; `words` are normalized.
    pub async fn contacts(&self, words: Vec<String>) -> Result<Vec<ContactRow>, CoreError> {
        let filter = vec!["instr(search, ?) > 0"; words.len()].join(" AND ");
        let rows = self
            .rows(Statement {
                sql: format!(
                    "SELECT account, href, name, organization, emails, sort FROM contacts {} ORDER BY sort, name",
                    if filter.is_empty() { String::new() } else { format!("WHERE {filter}") }
                ),
                params: words.into_iter().map(Value::from).collect(),
            })
            .await?;
        rows.iter()
            .map(|row| {
                Ok(ContactRow {
                    account: text(row, 0)?.to_owned(),
                    href: text(row, 1)?.to_owned(),
                    name: text(row, 2)?.to_owned(),
                    organization: optional(row, 3),
                    email: emails(row, 4)?.into_iter().next().map(|email| email.value),
                    sort: text(row, 5)?.to_owned(),
                })
            })
            .collect()
    }

    /// Every address of every contact, for suggestions.
    pub async fn contact_addresses(&self) -> Result<Vec<ContactAddress>, CoreError> {
        let rows = self
            .rows(statement!(
                "SELECT name, emails FROM contacts ORDER BY sort"
            ))
            .await?;
        let mut addresses = Vec::new();
        for row in &rows {
            let name = text(row, 0)?;
            addresses.extend(emails(row, 1)?.into_iter().map(|email| ContactAddress {
                name: name.to_owned(),
                email: email.value,
            }));
        }
        Ok(addresses)
    }

    pub async fn contact(
        &self,
        account: String,
        href: String,
    ) -> Result<Option<StoredContact>, CoreError> {
        let rows = self
            .rows(statement!(
                "SELECT book, uid, href, etag, name, given, family, organization, emails, phones, photo, vcard
                 FROM contacts WHERE account = ? AND href = ?",
                account.as_str(),
                href
            ))
            .await?;
        rows.first()
            .map(|row| {
                Ok(StoredContact {
                    account: account.clone(),
                    book: text(row, 0)?.to_owned(),
                    contact: Contact {
                        uid: text(row, 1)?.to_owned(),
                        href: text(row, 2)?.to_owned(),
                        etag: optional(row, 3),
                        name: text(row, 4)?.to_owned(),
                        given: optional(row, 5),
                        family: optional(row, 6),
                        organization: optional(row, 7),
                        emails: emails(row, 8)?,
                        phones: emails(row, 9)?,
                        photo: optional(row, 10),
                        vcard: text(row, 11)?.to_owned(),
                    },
                })
            })
            .transpose()
    }
}

#[cfg(test)]
mod tests {
    use crate::types::{
        AddressBook, Contact, ContactSyncResult, ContactSyncState, ContactValue, StoredContact,
    };

    fn book(href: &str, name: &str) -> AddressBook {
        AddressBook {
            href: href.to_owned(),
            name: name.to_owned(),
            ctag: None,
            sync_token: None,
            read_only: false,
        }
    }

    fn contact(href: &str, name: &str) -> Contact {
        Contact {
            uid: href.to_owned(),
            href: href.to_owned(),
            etag: Some(format!("\"{href}-1\"")),
            name: name.to_owned(),
            given: None,
            family: None,
            emails: Vec::new(),
            phones: Vec::new(),
            organization: None,
            photo: None,
            vcard: format!("vcard {href}"),
        }
    }

    fn value(value: &str, kind: Option<&str>) -> ContactValue {
        ContactValue {
            value: value.to_owned(),
            kind: kind.map(str::to_owned),
        }
    }

    fn synced(
        reset: bool,
        changed: Vec<Contact>,
        removed: &[&str],
        token: Option<&str>,
    ) -> ContactSyncResult {
        ContactSyncResult {
            state: ContactSyncState {
                sync_token: token.map(str::to_owned),
                ctag: None,
            },
            reset,
            changed,
            removed: removed.iter().map(|href| (*href).to_owned()).collect(),
        }
    }

    async fn names(store: &super::MailStore, words: &[&str]) -> Vec<String> {
        store
            .contacts(words.iter().map(|word| (*word).to_owned()).collect())
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.name)
            .collect()
    }

    #[tokio::test]
    async fn a_book_listed_again_keeps_its_sync_state_and_one_that_disappeared_goes() {
        let store = super::super::tests::store().await;
        store
            .save_address_books(
                "a",
                &[book("/personal/", "Personal"), book("/shared/", "Shared")],
            )
            .await
            .unwrap();
        store
            .apply_contact_sync(
                "a",
                "/shared/",
                &synced(true, vec![contact("/shared/g", "Grace")], &[], None),
            )
            .await
            .unwrap();
        store
            .apply_contact_sync(
                "a",
                "/personal/",
                &synced(
                    true,
                    vec![contact("/personal/a", "Ada")],
                    &[],
                    Some("token-1"),
                ),
            )
            .await
            .unwrap();
        let mut renamed = book("/personal/", "Renamed");
        renamed.sync_token = Some("server-token".to_owned());
        store.save_address_books("a", &[renamed]).await.unwrap();

        let books = store.address_books().await.unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(
            (
                books[0].book.name.as_str(),
                books[0].book.sync_token.as_deref()
            ),
            ("Renamed", Some("token-1"))
        );
        assert_eq!(names(&store, &[]).await, ["Ada"]);
        let (state, known) = store.sync_input("a", "/personal/").await.unwrap();
        assert_eq!(state.and_then(|s| s.sync_token).as_deref(), Some("token-1"));
        assert_eq!(known.len(), 1);
    }

    #[tokio::test]
    async fn a_sync_replaces_changed_cards_drops_removed_ones_and_a_reset_drops_the_rest() {
        let store = super::super::tests::store().await;
        store
            .save_address_books("a", &[book("/p/", "P")])
            .await
            .unwrap();
        let both = vec![contact("/1", "Ada Lovelace"), contact("/2", "Grace Hopper")];
        store
            .apply_contact_sync("a", "/p/", &synced(true, both, &[], None))
            .await
            .unwrap();
        store
            .apply_contact_sync(
                "a",
                "/p/",
                &synced(false, vec![contact("/1", "Ada King")], &["/2"], None),
            )
            .await
            .unwrap();
        assert_eq!(names(&store, &[]).await, ["Ada King"]);
        store
            .apply_contact_sync(
                "a",
                "/p/",
                &synced(true, vec![contact("/3", "New")], &[], None),
            )
            .await
            .unwrap();
        assert_eq!(names(&store, &[]).await, ["New"]);
    }

    #[tokio::test]
    async fn lists_by_family_name_and_finds_by_any_field_with_accents_folded() {
        let store = super::super::tests::store().await;
        for (href, given, family) in [
            ("/1", "Ada", "Lovelace"),
            ("/2", "Grace", "Hopper"),
            ("/3", "Charles", "Babbage"),
        ] {
            let mut person = contact(href, &format!("{given} {family}"));
            person.given = Some(given.to_owned());
            person.family = Some(family.to_owned());
            store
                .put_contact("a".to_owned(), "/p/".to_owned(), person)
                .await
                .unwrap();
        }
        assert_eq!(
            names(&store, &[]).await,
            ["Charles Babbage", "Grace Hopper", "Ada Lovelace"]
        );

        let mut elodie = contact("/4", "Élodie Marchand");
        elodie.organization = Some("Atelier Marchand".to_owned());
        elodie.emails = vec![value("elodie@atelier.test", Some("work"))];
        elodie.phones = vec![value("+33 6 12 34 56 78", Some("cell"))];
        store
            .put_contact("a".to_owned(), "/p/".to_owned(), elodie)
            .await
            .unwrap();
        store
            .put_contact("a".to_owned(), "/p/".to_owned(), contact("/6", "Plain"))
            .await
            .unwrap();
        store
            .put_contact("a".to_owned(), "/p/".to_owned(), contact("/5", "100% Pure"))
            .await
            .unwrap();
        assert_eq!(names(&store, &["elod"]).await, ["Élodie Marchand"]);
        assert_eq!(
            names(&store, &["atelier", "marchand"]).await,
            ["Élodie Marchand"]
        );
        assert_eq!(
            names(&store, &["elodie@atelier"]).await,
            ["Élodie Marchand"]
        );
        assert_eq!(names(&store, &["6 12"]).await, ["Élodie Marchand"]);
        assert_eq!(
            names(&store, &["elod", "lovelace"]).await,
            Vec::<String>::new()
        );
        assert_eq!(names(&store, &["%"]).await, ["100% Pure"]);
        assert_eq!(names(&store, &["_lain"]).await, Vec::<String>::new());
    }

    #[tokio::test]
    async fn reads_back_a_whole_card_and_lists_every_address_for_suggestions() {
        let store = super::super::tests::store().await;
        let mut ada = contact("/1", "Ada Lovelace");
        ada.given = Some("Ada".to_owned());
        ada.family = Some("Lovelace".to_owned());
        ada.organization = Some("Analytical Engines".to_owned());
        ada.emails = vec![
            value("ada@home.test", None),
            value("ada@work.test", Some("work")),
        ];
        ada.phones = vec![value("+44 20 7946 0000", Some("cell"))];
        ada.photo = Some("data:image/png;base64,AAAA".to_owned());
        store
            .put_contact("a".to_owned(), "/p/".to_owned(), ada.clone())
            .await
            .unwrap();

        assert_eq!(
            store
                .contact("a".to_owned(), "/1".to_owned())
                .await
                .unwrap(),
            Some(StoredContact {
                account: "a".to_owned(),
                book: "/p/".to_owned(),
                contact: ada,
            })
        );
        let rows = store.contacts(Vec::new()).await.unwrap();
        assert_eq!(rows[0].email.as_deref(), Some("ada@home.test"));
        let addresses: Vec<String> = store
            .contact_addresses()
            .await
            .unwrap()
            .into_iter()
            .map(|a| a.email)
            .collect();
        assert_eq!(addresses, ["ada@home.test", "ada@work.test"]);

        store
            .remove_contact("a".to_owned(), "/1".to_owned())
            .await
            .unwrap();
        assert_eq!(
            store
                .contact("a".to_owned(), "/1".to_owned())
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn forgetting_an_account_leaves_the_others_contacts() {
        let store = super::super::tests::store().await;
        store
            .save_address_books("a", &[book("/p/", "P")])
            .await
            .unwrap();
        store
            .save_address_books("b", &[book("/p/", "P")])
            .await
            .unwrap();
        store
            .put_contact("a".to_owned(), "/p/".to_owned(), contact("/1", "Mine"))
            .await
            .unwrap();
        store
            .put_contact("b".to_owned(), "/p/".to_owned(), contact("/1", "Theirs"))
            .await
            .unwrap();
        store.delete_account("a".to_owned()).await.unwrap();
        assert_eq!(names(&store, &[]).await, ["Theirs"]);
        let accounts: Vec<String> = store
            .address_books()
            .await
            .unwrap()
            .into_iter()
            .map(|b| b.account)
            .collect();
        assert_eq!(accounts, ["b"]);
    }
}
