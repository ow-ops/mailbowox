//! vCards through calcard: the contact record the app reads and the cards a
//! draft writes. Update rewrites only the draft's fields; every other
//! property stays as the server stored it.

use calcard::vcard::{
    VCard, VCardEntry, VCardParameter, VCardParameterName, VCardParameterValue, VCardProperty,
    VCardValue, VCardVersion,
};

use crate::{
    error::CoreError,
    types::{Contact, ContactDraft, ContactValue},
};

const PRODID: &str = "-//ow-ops//mailbowox//EN";
// Types that say how a value is encoded or preferred, not what it is for.
const NO_KIND: [&str; 2] = ["pref", "internet"];

fn parse(vcard: &str) -> Result<VCard, CoreError> {
    VCard::parse(vcard).map_err(|_| CoreError::invalid("not a vCard"))
}

/// The card's own name, else its first address. `None` when it is not a
/// vCard.
pub fn contact(href: String, etag: Option<String>, vcard: String) -> Option<Contact> {
    let card = parse(&vcard).ok()?;
    let emails = values(&card, &VCardProperty::Email);
    let name = text(&card, &VCardProperty::Fn)
        .or_else(|| emails.first().map(|email| email.value.clone()))
        .unwrap_or_default();
    let name_parts = card.property(&VCardProperty::N);

    Some(Contact {
        uid: card.uid().unwrap_or_default().to_owned(),
        href,
        etag,
        name,
        family: name_parts.and_then(|n| component(n, 0)),
        given: name_parts.and_then(|n| component(n, 1)),
        emails,
        phones: values(&card, &VCardProperty::Tel),
        organization: card
            .property(&VCardProperty::Org)
            .and_then(|org| component(org, 0)),
        photo: card
            .property(&VCardProperty::Photo)
            .and_then(|photo| photo.values.first().cloned()?.into_uri()),
        vcard,
    })
}

pub fn new_contact(uid: &str, draft: &ContactDraft) -> String {
    let mut card = VCard::default();
    card.entries
        .push(VCardEntry::new(VCardProperty::Uid).with_value(uid.to_owned()));
    card.entries
        .push(VCardEntry::new(VCardProperty::Prodid).with_value(PRODID.to_owned()));
    write_draft(&mut card, draft);
    let mut out = String::new();
    card.write_to(&mut out, VCardVersion::V3_0)
        .expect("writing to a String cannot fail");
    out
}

pub fn update_contact(vcard: &str, draft: &ContactDraft) -> Result<String, CoreError> {
    let mut card = parse(vcard)?;
    card.entries.retain(|entry| {
        !matches!(
            entry.name,
            VCardProperty::Fn | VCardProperty::N | VCardProperty::Email | VCardProperty::Tel
        )
    });
    write_draft(&mut card, draft);
    // calcard escapes the comma of an inline version 4 photo, which is a URI
    // and takes no escapes.
    Ok(card.to_string().replace(";base64\\,", ";base64,"))
}

fn write_draft(card: &mut VCard, draft: &ContactDraft) {
    let entries = &mut card.entries;
    entries.push(VCardEntry::new(VCardProperty::Fn).with_value(draft.name.clone()));
    entries.push(
        VCardEntry::new(VCardProperty::N).with_values(
            [&draft.family, &draft.given, &None, &None, &None]
                .map(|part| VCardValue::Text(part.clone().unwrap_or_default()))
                .to_vec(),
        ),
    );
    entries.extend(
        draft
            .emails
            .iter()
            .map(|value| entry(VCardProperty::Email, value)),
    );
    entries.extend(
        draft
            .phones
            .iter()
            .map(|value| entry(VCardProperty::Tel, value)),
    );
    set_organization(card, draft.organization.as_deref());
}

fn entry(name: VCardProperty, value: &ContactValue) -> VCardEntry {
    VCardEntry::new(name)
        .with_param_opt(value.kind.clone().map(VCardParameter::typ))
        .with_value(value.value.clone())
}

// Departments follow the organization name in the same property.
fn set_organization(card: &mut VCard, organization: Option<&str>) {
    let Some(index) = card
        .entries
        .iter()
        .position(|entry| entry.name == VCardProperty::Org)
    else {
        if let Some(organization) = organization {
            card.entries
                .push(VCardEntry::new(VCardProperty::Org).with_value(organization.to_owned()));
        }
        return;
    };

    let org = &mut card.entries[index];
    match (organization, org.values.len()) {
        (Some(name), 0) => org.values.push(VCardValue::Text(name.to_owned())),
        (Some(name), _) => org.values[0] = VCardValue::Text(name.to_owned()),
        (None, 0 | 1) => {
            card.entries.remove(index);
        }
        (None, _) => org.values[0] = VCardValue::Text(String::new()),
    }
}

fn text(card: &VCard, name: &VCardProperty) -> Option<String> {
    component(card.property(name)?, 0)
}

fn component(entry: &VCardEntry, index: usize) -> Option<String> {
    entry
        .values
        .get(index)?
        .as_text()
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

fn values(card: &VCard, name: &VCardProperty) -> Vec<ContactValue> {
    card.properties(name)
        .filter_map(|entry| {
            Some(ContactValue {
                value: component(entry, 0)?,
                kind: kind(entry),
            })
        })
        .collect()
}

fn kind(entry: &VCardEntry) -> Option<String> {
    entry
        .parameters(&VCardParameterName::Type)
        .filter_map(VCardParameterValue::as_text)
        .map(str::to_lowercase)
        .find(|kind| !NO_KIND.contains(&kind.as_str()))
}
#[cfg(test)]
mod tests {
    use super::{contact, new_contact, update_contact};
    use crate::types::{Contact, ContactDraft, ContactValue};

    const V3: &str = "BEGIN:VCARD\r
VERSION:3.0\r
UID:jane-1\r
FN:Jane Doe\r
N:Doe;Jane;;;\r
EMAIL;TYPE=INTERNET,WORK,pref:jane@work.test\r
EMAIL;TYPE=HOME:jane@home.test\r
EMAIL:plain@home.test\r
TEL;TYPE=CELL,VOICE:+33 6 12 34 56 78\r
TEL;TYPE=fax:+33 1 00 00 00 00\r
ORG:Acme;Sales;EMEA\r
NOTE:Met at the fair\r
X-CUSTOM:kept\r
PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRg==\r
END:VCARD\r
";

    const V4: &str = "BEGIN:VCARD\r
VERSION:4.0\r
UID:urn:uuid:4fbe8971\r
FN:Jean Dupont\r
N:Dupont;Jean;;;\r
EMAIL;TYPE=work:jean@work.test\r
TEL;TYPE=\"work,voice\";VALUE=uri:tel:+33-1-23-45-67-89\r
ORG:Acme\r
PHOTO:data:image/png;base64,iVBORw0KGgo=\r
END:VCARD\r
";

    fn read(vcard: &str) -> Contact {
        contact("/book/c.vcf".into(), Some("e1".into()), vcard.into()).expect("a contact")
    }

    fn value(value: &str, kind: Option<&str>) -> ContactValue {
        ContactValue {
            value: value.into(),
            kind: kind.map(Into::into),
        }
    }

    fn draft() -> ContactDraft {
        ContactDraft {
            name: "Jane Roe".into(),
            given: Some("Jane".into()),
            family: Some("Roe".into()),
            emails: vec![value("jane@new.test", Some("work"))],
            phones: vec![value("+1 555 0100", Some("cell"))],
            organization: Some("Globex".into()),
        }
    }

    #[test]
    fn reads_a_version_3_card() {
        let contact = read(V3);
        assert_eq!(contact.uid, "jane-1");
        assert_eq!(contact.etag.as_deref(), Some("e1"));
        assert_eq!(contact.name, "Jane Doe");
        assert_eq!(contact.given.as_deref(), Some("Jane"));
        assert_eq!(contact.family.as_deref(), Some("Doe"));
        assert_eq!(contact.organization.as_deref(), Some("Acme"));
        assert_eq!(contact.vcard, V3);
    }

    #[test]
    fn reads_a_version_4_card() {
        let contact = read(V4);
        assert_eq!(contact.uid, "urn:uuid:4fbe8971");
        assert_eq!(contact.name, "Jean Dupont");
        assert_eq!(contact.emails, [value("jean@work.test", Some("work"))]);
        assert_eq!(
            contact.phones,
            [value("tel:+33-1-23-45-67-89", Some("work"))]
        );
    }

    #[test]
    fn value_kind_is_the_first_type_without_pref_and_internet() {
        let contact = read(V3);
        assert_eq!(
            contact.emails,
            [
                value("jane@work.test", Some("work")),
                value("jane@home.test", Some("home")),
                value("plain@home.test", None),
            ]
        );
        assert_eq!(
            contact.phones,
            [
                value("+33 6 12 34 56 78", Some("cell")),
                value("+33 1 00 00 00 00", Some("fax")),
            ]
        );
    }

    #[test]
    fn inline_photo_becomes_a_data_uri() {
        assert_eq!(
            read(V3).photo.as_deref(),
            Some("data:image/jpeg;base64,/9j/4AAQSkZJRg==")
        );
        assert_eq!(
            read(V4).photo.as_deref(),
            Some("data:image/png;base64,iVBORw0KGgo=")
        );
    }

    #[test]
    fn photo_uri_is_kept_as_is() {
        let card = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:A\r\nPHOTO;VALUE=uri:https://example.test/a.png\r\nEND:VCARD\r\n";
        assert_eq!(
            read(card).photo.as_deref(),
            Some("https://example.test/a.png")
        );
    }

    #[test]
    fn name_falls_back_to_the_first_email_then_to_nothing() {
        let emailed = "BEGIN:VCARD\r\nVERSION:3.0\r\nEMAIL:only@home.test\r\nEND:VCARD\r\n";
        assert_eq!(read(emailed).name, "only@home.test");
        let bare = "BEGIN:VCARD\r\nVERSION:3.0\r\nTEL:123\r\nEND:VCARD\r\n";
        assert_eq!(read(bare).name, "");
    }

    #[test]
    fn a_card_without_uid_has_an_empty_uid() {
        let card = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:A\r\nEND:VCARD\r\n";
        assert_eq!(read(card).uid, "");
    }

    #[test]
    fn text_that_is_not_a_vcard_is_no_contact() {
        assert_eq!(contact("/c.vcf".into(), None, "hello".into()), None);
    }

    #[test]
    fn a_new_card_is_version_3_and_reads_back_as_the_draft() {
        let vcard = new_contact("u1", &draft());
        assert!(
            vcard.starts_with("BEGIN:VCARD\r\nVERSION:3.0\r\n"),
            "{vcard}"
        );
        assert!(
            vcard.contains("PRODID:-//ow-ops//mailbowox//EN\r\n"),
            "{vcard}"
        );

        let contact = read(&vcard);
        assert_eq!(contact.uid, "u1");
        assert_eq!(contact.name, "Jane Roe");
        assert_eq!(contact.given.as_deref(), Some("Jane"));
        assert_eq!(contact.family.as_deref(), Some("Roe"));
        assert_eq!(contact.emails, draft().emails);
        assert_eq!(contact.phones, draft().phones);
        assert_eq!(contact.organization.as_deref(), Some("Globex"));
        assert_eq!(contact.photo, None);
    }

    #[test]
    fn a_new_card_escapes_separators_in_names() {
        let mut named = draft();
        named.name = "Doe; Jane, Esq.".into();
        named.family = Some("Doe; Esq.".into());
        let contact = read(&new_contact("u1", &named));
        assert_eq!(contact.name, "Doe; Jane, Esq.");
        assert_eq!(contact.family.as_deref(), Some("Doe; Esq."));
    }

    #[test]
    fn update_rewrites_the_drafted_fields_and_keeps_the_rest() {
        let updated = update_contact(V3, &draft()).expect("update");
        let contact = read(&updated);
        assert_eq!(contact.uid, "jane-1");
        assert_eq!(contact.name, "Jane Roe");
        assert_eq!(contact.family.as_deref(), Some("Roe"));
        assert_eq!(contact.emails, draft().emails);
        assert_eq!(contact.phones, draft().phones);
        assert_eq!(contact.photo, read(V3).photo);
        assert!(updated.contains("NOTE:Met at the fair\r\n"), "{updated}");
        assert!(updated.contains("X-CUSTOM:kept\r\n"), "{updated}");
    }

    #[test]
    fn update_keeps_the_version_of_the_card() {
        let v3 = update_contact(V3, &draft()).expect("update");
        assert!(v3.starts_with("BEGIN:VCARD\r\nVERSION:3.0\r\n"), "{v3}");
        let v4 = update_contact(V4, &draft()).expect("update");
        assert!(v4.starts_with("BEGIN:VCARD\r\nVERSION:4.0\r\n"), "{v4}");
    }

    #[test]
    fn update_leaves_a_version_4_photo_readable() {
        let updated = update_contact(V4, &draft()).expect("update");
        assert!(
            updated.contains("PHOTO:data:image/png;base64,iVBORw0KGgo=\r\n"),
            "{updated}"
        );
        assert_eq!(read(&updated).photo, read(V4).photo);
    }

    #[test]
    fn update_replaces_only_the_first_organization_component() {
        let updated = update_contact(V3, &draft()).expect("update");
        assert!(updated.contains("ORG:Globex;Sales;EMEA\r\n"), "{updated}");
    }

    #[test]
    fn update_clears_an_organization_but_keeps_its_departments() {
        let mut cleared = draft();
        cleared.organization = None;
        let updated = update_contact(V3, &cleared).expect("update");
        assert!(updated.contains("ORG:;Sales;EMEA\r\n"), "{updated}");
        assert_eq!(read(&updated).organization, None);
    }

    #[test]
    fn update_drops_a_lone_organization_that_is_cleared() {
        let mut cleared = draft();
        cleared.organization = None;
        let updated = update_contact(V4, &cleared).expect("update");
        assert!(!updated.contains("ORG"), "{updated}");
    }

    #[test]
    fn update_adds_an_organization_to_a_card_without_one() {
        let card = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:u\r\nFN:A\r\nEND:VCARD\r\n";
        let updated = update_contact(card, &draft()).expect("update");
        assert_eq!(read(&updated).organization.as_deref(), Some("Globex"));
    }

    #[test]
    fn update_refuses_text_that_is_not_a_vcard() {
        assert!(update_contact("hello", &draft()).is_err());
    }
}
