//! Contacts over io-webdav: finding the address book home, listing address
//! books, and syncing and writing contacts.

use std::collections::HashMap;

use io_webdav::{
    rfc4918::{
        DISPLAYNAME, GETCTAG, RESOURCETYPE, SYNC_TOKEN, WebdavProperty, id_from_location,
        propfind::WebdavPropfind,
        typed::{WebdavMultistatusOf, WebdavResponseOf},
    },
    rfc6352::card::{
        create::CarddavCardCreate, delete::CarddavCardDelete, multiget::CarddavCardMultiget,
        update::CarddavCardUpdate,
    },
};
use serde::Deserialize;
use url::Url;
use uuid::Uuid;

use crate::{
    dav::{
        CURRENT_USER_PRIVILEGE_SET, Dav, Names, Privileges, USER_AGENT, absolute, read_only,
        same_origin_url,
    },
    error::CoreError,
    types::{
        AccountConfig, AddressBook, Contact, ContactDraft, ContactSyncResult, ContactSyncState,
        ContactTag,
    },
    vcard,
};

const MULTIGET_BATCH: usize = 50;

const ADDRESS_BOOK_PROPS: &[WebdavProperty] = &[
    RESOURCETYPE,
    DISPLAYNAME,
    GETCTAG,
    SYNC_TOKEN,
    CURRENT_USER_PRIVILEGE_SET,
];

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct AddressBookProps {
    resourcetype: Option<Names>,
    displayname: Option<String>,
    getctag: Option<String>,
    sync_token: Option<String>,
    current_user_privilege_set: Option<Privileges>,
}

pub(crate) async fn discover(config: &AccountConfig) -> Result<Option<String>, CoreError> {
    Dav::new(config).discover(config).await
}

pub(crate) async fn list(
    config: &AccountConfig,
    home: &str,
) -> Result<Vec<AddressBook>, CoreError> {
    let dav = Dav::new(config);
    let home = dav.url(home)?;
    let propfind = WebdavPropfind::<WebdavMultistatusOf<AddressBookProps>>::new(
        &home,
        &dav.auth,
        USER_AGENT,
        "",
        1,
        ADDRESS_BOOK_PROPS,
    );
    let multistatus = dav.run(&home, propfind).await??;
    Ok(multistatus
        .responses
        .into_iter()
        .filter_map(|response| address_book(&home, response))
        .collect())
}

fn address_book(home: &Url, response: WebdavResponseOf<AddressBookProps>) -> Option<AddressBook> {
    let props = response.props;
    if !props
        .resourcetype
        .is_some_and(|types| types.contains("addressbook"))
    {
        return None;
    }

    let name = props
        .displayname
        .filter(|name| !name.is_empty())
        .or_else(|| id_from_location(&response.href))
        .unwrap_or_default();
    Some(AddressBook {
        href: absolute(home, &response.href)?,
        name,
        ctag: props.getctag,
        sync_token: props.sync_token,
        read_only: read_only(props.current_user_privilege_set),
    })
}

pub(crate) async fn sync(
    config: &AccountConfig,
    address_book: &str,
    since: Option<ContactSyncState>,
    known: &[ContactTag],
) -> Result<ContactSyncResult, CoreError> {
    let dav = Dav::new(config);
    let address_book = dav.url(address_book)?;
    let since = since.unwrap_or_default();
    let known: HashMap<&str, &str> = known
        .iter()
        .map(|tag| (tag.href.as_str(), tag.etag.as_str()))
        .collect();
    let found = dav
        .sync(
            &address_book,
            since.sync_token.as_deref(),
            since.ctag,
            &known,
        )
        .await?;
    Ok(ContactSyncResult {
        state: ContactSyncState {
            sync_token: found.sync_token,
            ctag: found.ctag,
        },
        reset: found.reset,
        changed: fetch(&dav, &address_book, &found.changed).await?,
        removed: found.removed,
        kept: found.kept,
    })
}

async fn fetch(dav: &Dav, address_book: &Url, hrefs: &[String]) -> Result<Vec<Contact>, CoreError> {
    let mut contacts = Vec::new();
    for batch in hrefs.chunks(MULTIGET_BATCH) {
        let ids: Vec<String> = batch
            .iter()
            .filter_map(|href| id_from_location(href))
            .collect();
        let ids: Vec<&str> = ids.iter().map(String::as_str).collect();
        let multiget = CarddavCardMultiget::new(
            address_book,
            &dav.auth,
            USER_AGENT,
            address_book.path(),
            &ids,
        );
        for card in dav.run(address_book, multiget).await??.cards {
            let (Some(href), Ok(vcard)) = (
                absolute(address_book, &card.href),
                String::from_utf8(card.data),
            ) else {
                continue;
            };
            contacts.extend(vcard::contact(href, card.etag, vcard));
        }
    }
    Ok(contacts)
}

pub(crate) async fn create(
    config: &AccountConfig,
    address_book: &str,
    draft: &ContactDraft,
) -> Result<Contact, CoreError> {
    let dav = Dav::new(config);
    let address_book = dav.url(address_book)?;
    let uid = Uuid::new_v4().to_string();
    let vcard = vcard::new_contact(&uid, draft);
    let create = CarddavCardCreate::new(
        &address_book,
        &dav.auth,
        USER_AGENT,
        address_book.path(),
        &format!("{uid}.vcf"),
        vcard.clone().into_bytes(),
    );
    let created = dav.run(&address_book, create).await??;
    let href = same_origin_url(&address_book, &created.href).ok_or_else(|| {
        CoreError::protocol("the server named the contact with an invalid or cross-origin URL")
    })?;
    written(&dav, href, created.etag, vcard).await
}

pub(crate) async fn update(
    config: &AccountConfig,
    contact: &Contact,
    draft: &ContactDraft,
) -> Result<Contact, CoreError> {
    let dav = Dav::new(config);
    let vcard = vcard::update_contact(&contact.vcard, draft)?;
    let (href, address_book, id) = dav.locate(&contact.href)?;
    let update = CarddavCardUpdate::new(
        &href,
        &dav.auth,
        USER_AGENT,
        address_book.path(),
        &id,
        vcard.clone().into_bytes(),
        contact.etag.as_deref(),
    );
    let updated = dav.run(&href, update).await??;
    written(&dav, href, updated.etag, vcard).await
}

pub(crate) async fn delete(
    config: &AccountConfig,
    href: &str,
    etag: Option<&str>,
) -> Result<(), CoreError> {
    let dav = Dav::new(config);
    let (href, address_book, id) = dav.locate(href)?;
    let delete =
        CarddavCardDelete::new(&href, &dav.auth, USER_AGENT, address_book.path(), &id, etag);
    dav.run(&href, delete).await??;
    Ok(())
}

/// A server that changed the card on the way in sends no `ETag`, so the stored
/// copy is read back.
async fn written(
    dav: &Dav,
    href: Url,
    etag: Option<String>,
    vcard: String,
) -> Result<Contact, CoreError> {
    let contact = if let Some(etag) = etag {
        vcard::contact(href.into(), Some(etag), vcard)
    } else {
        let address_book = href.join(".").map_err(CoreError::invalid)?;
        fetch(dav, &address_book, &[href.into()]).await?.pop()
    };
    contact.ok_or_else(|| CoreError::protocol("the server did not keep the contact"))
}
