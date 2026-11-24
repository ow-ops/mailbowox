//! Inbox categories, decided on the device from how a message was sent. Rules
//! rather than a model: the headers bulk senders must set, the sender's
//! address and the words of the subject. People you write to and senders you
//! moved by hand come first; the store applies those.

use mail_parser::MessageRef;

/// Ordered from the most to the least important.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    uniffi::Enum,
    serde::Serialize,
    serde::Deserialize,
)]
pub enum Category {
    /// What people write, and what can't wait: sign-in codes, security alerts, bounces.
    #[default]
    Primary,
    /// Receipts, orders, deliveries and bookings.
    Transactions,
    /// Newsletters and notifications.
    Updates,
    /// Offers and other marketing.
    Promotions,
}

impl Category {
    pub(crate) const fn code(self) -> i64 {
        match self {
            Self::Primary => 0,
            Self::Transactions => 1,
            Self::Updates => 2,
            Self::Promotions => 3,
        }
    }
}

/// Headers only bulk senders set: mailing lists and bulk mail.
const BULK: [&str; 3] = ["List-Id", "List-Unsubscribe", "Precedence"];

/// Headers marketing platforms add to campaigns.
const MARKETING: [&str; 6] = [
    "X-Campaign",
    "X-CampaignID",
    "X-MC-User",
    "X-Mailgun-Tag",
    "X-SG-EID",
    "Feedback-ID",
];

/// The headers `classify` reads, for fetching them with the summary.
pub(crate) const HEADERS: [&str; 10] = [
    "LIST-ID",
    "LIST-UNSUBSCRIBE",
    "PRECEDENCE",
    "AUTO-SUBMITTED",
    "X-CAMPAIGN",
    "X-CAMPAIGNID",
    "X-MC-USER",
    "X-MAILGUN-TAG",
    "X-SG-EID",
    "FEEDBACK-ID",
];

/// Words that keep a message in Primary however it was sent.
const URGENT: [&str; 14] = [
    "verification code",
    "security code",
    "sign-in",
    "sign in",
    "login code",
    "password",
    "security alert",
    "undeliverable",
    "delivery status notification",
    "code de vérification",
    "code de connexion",
    "mot de passe",
    "alerte de sécurité",
    "non distribuable",
];

const TRANSACTIONS: [&str; 20] = [
    "receipt",
    "invoice",
    "order",
    "payment",
    "shipped",
    "shipping",
    "delivery",
    "delivered",
    "booking",
    "reservation",
    "ticket",
    "itinerary",
    "reçu",
    "facture",
    "commande",
    "paiement",
    "expédié",
    "livraison",
    "réservation",
    "billet",
];

const PROMOTIONS: [&str; 12] = [
    "sale",
    "% off",
    "discount",
    "deal",
    "offer",
    "promo",
    "coupon",
    "free shipping",
    "soldes",
    "réduction",
    "offre",
    "code promo",
];

fn has(message: MessageRef<'_>, name: &str) -> bool {
    message.headers().get(name).is_some()
}

fn automated(message: MessageRef<'_>) -> bool {
    message
        .headers()
        .get("Auto-Submitted")
        .and_then(|header| header.value().as_text())
        .is_some_and(|value| !value.trim().eq_ignore_ascii_case("no"))
}

fn no_reply(message: MessageRef<'_>) -> bool {
    message
        .from()
        .and_then(|from| from.first())
        .and_then(|address| address.address())
        .is_some_and(|email| {
            let local = email.split('@').next().unwrap_or_default().to_lowercase();
            [
                "noreply",
                "no-reply",
                "donotreply",
                "do-not-reply",
                "notifications",
                "notification",
            ]
            .iter()
            .any(|name| local == *name)
        })
}

fn mentions(subject: &str, words: &[&str]) -> bool {
    words.iter().any(|word| subject.contains(word))
}

pub(crate) fn classify(message: MessageRef<'_>) -> Category {
    let subject = message.subject().unwrap_or_default().to_lowercase();
    let from_daemon = message
        .from()
        .and_then(|from| from.first())
        .and_then(|address| address.address())
        .is_some_and(|email| email.to_lowercase().starts_with("mailer-daemon@"));
    if from_daemon || mentions(&subject, &URGENT) {
        return Category::Primary;
    }
    let bulk = BULK.iter().any(|name| has(message, name));
    let marketing = MARKETING.iter().any(|name| has(message, name));
    if !bulk && !marketing && !automated(message) && !no_reply(message) {
        return Category::Primary;
    }
    if mentions(&subject, &TRANSACTIONS) {
        Category::Transactions
    } else if marketing || mentions(&subject, &PROMOTIONS) {
        Category::Promotions
    } else {
        Category::Updates
    }
}

#[cfg(test)]
mod tests {
    use mail_parser::MessageParser;

    use super::{Category, classify};

    fn category(raw: &str) -> Category {
        let message = MessageParser::new().parse(raw.as_bytes()).unwrap();
        classify(message.root())
    }

    #[test]
    fn a_person_writing_is_primary() {
        assert_eq!(
            category("From: Bob <bob@example.com>\r\nSubject: Lunch on Friday\r\n\r\nhi"),
            Category::Primary
        );
    }

    #[test]
    fn a_receipt_sent_in_bulk_is_a_transaction() {
        assert_eq!(
            category("From: Shop <noreply@shop.example>\r\nSubject: Your order receipt\r\n\r\nx"),
            Category::Transactions
        );
        assert_eq!(
            category(
                "From: Rail <tickets@rail.example>\r\nList-Unsubscribe: <https://rail.example/u>\r\nSubject: Votre réservation\r\n\r\nx"
            ),
            Category::Transactions
        );
    }

    #[test]
    fn a_campaign_is_a_promotion() {
        assert_eq!(
            category(
                "From: Shop <news@shop.example>\r\nX-Campaign: spring\r\nSubject: New arrivals\r\n\r\nx"
            ),
            Category::Promotions
        );
        assert_eq!(
            category(
                "From: Shop <news@shop.example>\r\nList-Unsubscribe: <https://shop.example/u>\r\nSubject: 30% off this week\r\n\r\nx"
            ),
            Category::Promotions
        );
    }

    #[test]
    fn a_newsletter_or_notification_is_an_update() {
        assert_eq!(
            category(
                "From: Weekly <hello@news.example>\r\nList-Id: <weekly.news.example>\r\nSubject: This week in Rust\r\n\r\nx"
            ),
            Category::Updates
        );
        assert_eq!(
            category(
                "From: Forge <forge@example.org>\r\nAuto-Submitted: auto-generated\r\nSubject: New comment on #12\r\n\r\nx"
            ),
            Category::Updates
        );
    }

    #[test]
    fn codes_security_alerts_and_bounces_stay_primary_however_they_were_sent() {
        assert_eq!(
            category(
                "From: Bank <noreply@bank.example>\r\nList-Unsubscribe: <https://bank.example/u>\r\nSubject: Your verification code is 123456\r\n\r\nx"
            ),
            Category::Primary
        );
        assert_eq!(
            category(
                "From: Mail Delivery <MAILER-DAEMON@mx.example>\r\nAuto-Submitted: auto-replied\r\nSubject: Returned mail\r\n\r\nx"
            ),
            Category::Primary
        );
    }

    #[test]
    fn auto_submitted_no_is_a_person() {
        assert_eq!(
            category(
                "From: Bob <bob@example.com>\r\nAuto-Submitted: no\r\nSubject: Order of the day\r\n\r\nx"
            ),
            Category::Primary
        );
    }
}
