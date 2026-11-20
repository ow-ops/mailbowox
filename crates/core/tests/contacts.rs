mod common;

use tokio::sync::Mutex;

use mailbowox_core::{
    AccountConfig, Contact, ContactDraft, ContactSyncResult, ContactSyncState, ContactTag,
    ContactValue, CoreError, create_contact, delete_contact, discover_contacts, list_address_books,
    sync_contacts, update_contact,
};

// Stalwart caps concurrent requests per account, and the ctag test needs the
// address book to hold still.
static SERVER: Mutex<()> = Mutex::const_new(());

const PHOTO: &str = "PHOTO;ENCODING=b;TYPE=PNG:iVBORw0KGgo=\r\n";

async fn alice_book() -> (AccountConfig, String) {
    let config = common::account("alice");
    let home = discover_contacts(config.clone())
        .await
        .expect("discover")
        .expect("an address book home");
    let book = list_address_books(config.clone(), home)
        .await
        .expect("list")
        .into_iter()
        .find(|book| !book.read_only)
        .expect("a writable address book");
    (config, book.href)
}

fn person(name: &str) -> ContactDraft {
    ContactDraft {
        name: name.to_owned(),
        given: Some("Ada".to_owned()),
        family: Some("Lovelace".to_owned()),
        emails: vec![ContactValue {
            value: "ada@example.test".to_owned(),
            kind: Some("work".to_owned()),
        }],
        phones: vec![ContactValue {
            value: "+33 1 23 45 67 89".to_owned(),
            kind: Some("cell".to_owned()),
        }],
        organization: Some("Analytical Engines".to_owned()),
    }
}

async fn sync(
    config: &AccountConfig,
    book: &str,
    since: Option<ContactSyncState>,
    known: Vec<ContactTag>,
) -> ContactSyncResult {
    sync_contacts(config.clone(), book.to_owned(), since, known)
        .await
        .expect("sync")
}

async fn create(config: &AccountConfig, book: &str, draft: ContactDraft) -> Contact {
    create_contact(config.clone(), book.to_owned(), draft)
        .await
        .expect("create")
}

async fn delete(config: &AccountConfig, contact: &Contact) {
    delete_contact(config.clone(), contact.href.clone(), contact.etag.clone())
        .await
        .expect("delete");
}

#[tokio::test]
async fn sync_reports_created_updated_and_deleted_contacts() {
    let Some(()) = common::local_server() else {
        return;
    };
    let _server = SERVER.lock().await;
    let (config, book) = alice_book().await;
    let initial = sync(&config, &book, None, Vec::new()).await;
    assert!(initial.reset);

    let name = common::unique("Ada");
    let created = create(&config, &book, person(&name)).await;
    assert_eq!(created.name, name);
    assert_eq!(created.family.as_deref(), Some("Lovelace"));
    assert_eq!(created.organization.as_deref(), Some("Analytical Engines"));
    assert_eq!(created.emails, person(&name).emails);
    assert_eq!(created.phones, person(&name).phones);
    assert!(created.href.ends_with(&format!("{}.vcf", created.uid)));

    let added = sync(&config, &book, Some(initial.state), Vec::new()).await;
    assert!(!added.reset);
    let synced = added
        .changed
        .iter()
        .find(|contact| contact.href == created.href)
        .expect("the new contact");
    assert_eq!(synced.name, name);
    assert_eq!(synced.uid, created.uid);

    let renamed = common::unique("Grace");
    let updated = update_contact(config.clone(), created.clone(), person(&renamed))
        .await
        .expect("update");
    assert_eq!(updated.href, created.href);
    assert_eq!(updated.uid, created.uid);
    assert_ne!(updated.etag, created.etag);

    let changed = sync(&config, &book, Some(added.state), Vec::new()).await;
    let synced = changed
        .changed
        .iter()
        .find(|contact| contact.href == created.href)
        .expect("the updated contact");
    assert_eq!(synced.name, renamed);

    delete(&config, &updated).await;
    let removed = sync(&config, &book, Some(changed.state), Vec::new()).await;
    assert!(removed.removed.contains(&created.href), "{removed:?}");
}

#[tokio::test]
async fn update_refuses_a_stale_etag() {
    let Some(()) = common::local_server() else {
        return;
    };
    let _server = SERVER.lock().await;
    let (config, book) = alice_book().await;
    let created = create(&config, &book, person(&common::unique("Stale"))).await;
    let updated = update_contact(config.clone(), created.clone(), person("First"))
        .await
        .expect("update");

    update_contact(config.clone(), created, person("Second"))
        .await
        .expect_err("the etag changed");
    delete(&config, &updated).await;
}

#[tokio::test]
async fn ctag_sync_diffs_the_etag_listing() {
    let Some(()) = common::local_server() else {
        return;
    };
    let _server = SERVER.lock().await;
    let (config, book) = alice_book().await;
    let created = create(&config, &book, person(&common::unique("Ctag"))).await;
    let gone = format!("{book}gone.vcf");
    let stale = ContactSyncState {
        sync_token: None,
        ctag: Some("stale".to_owned()),
    };

    let listed = sync(
        &config,
        &book,
        Some(stale.clone()),
        vec![ContactTag {
            href: gone.clone(),
            etag: "1".to_owned(),
        }],
    )
    .await;
    assert!(!listed.reset);
    assert!(listed.state.ctag.is_some());
    assert!(
        listed
            .changed
            .iter()
            .any(|contact| contact.href == created.href)
    );
    assert_eq!(listed.removed, [gone]);

    let known: Vec<ContactTag> = listed
        .changed
        .iter()
        .map(|contact| ContactTag {
            href: contact.href.clone(),
            etag: contact.etag.clone().expect("an etag"),
        })
        .collect();
    let unchanged = sync(&config, &book, Some(stale), known).await;
    assert_eq!(unchanged.changed, []);
    assert_eq!(unchanged.removed, [] as [String; 0]);

    let current = sync(&config, &book, Some(listed.state), Vec::new()).await;
    assert_eq!(current.changed, []);
    delete(&config, &created).await;
}

#[tokio::test]
async fn a_photo_survives_an_update() {
    let Some(()) = common::local_server() else {
        return;
    };
    let _server = SERVER.lock().await;
    let (config, book) = alice_book().await;
    let created = create(&config, &book, person(&common::unique("Photo"))).await;
    let mut with_photo = created.clone();
    with_photo.vcard = created
        .vcard
        .replacen("END:VCARD", &format!("{PHOTO}END:VCARD"), 1);
    let photographed = update_contact(config.clone(), with_photo, person(&created.name))
        .await
        .expect("add the photo");
    assert_eq!(
        photographed.photo.as_deref(),
        Some("data:image/png;base64,iVBORw0KGgo=")
    );

    let renamed = common::unique("Renamed");
    let updated = update_contact(config.clone(), photographed.clone(), person(&renamed))
        .await
        .expect("update");
    assert_eq!(updated.photo, photographed.photo);

    let synced = sync(&config, &book, None, Vec::new())
        .await
        .changed
        .into_iter()
        .find(|contact| contact.href == created.href)
        .expect("the contact");
    assert_eq!(synced.name, renamed);
    assert_eq!(synced.photo, photographed.photo);
    delete(&config, &updated).await;
}

#[tokio::test]
async fn discovery_starts_from_the_carddav_url() {
    let Some(()) = common::local_server() else {
        return;
    };
    let config = common::account("alice");
    let home = discover_contacts(config)
        .await
        .expect("discover")
        .expect("an address book home");
    assert!(
        home.starts_with(&format!("http://{}:18080/dav/card/", common::host())),
        "{home}"
    );
}

#[tokio::test]
async fn plain_http_needs_a_plain_http_contact_server() {
    let mut config = common::account("alice");
    config.carddav_url = None;
    let refused =
        list_address_books(config, "http://127.0.0.1:18080/dav/card/alice/".to_owned()).await;
    assert!(
        matches!(refused, Err(CoreError::Invalid { .. })),
        "{refused:?}"
    );
}
