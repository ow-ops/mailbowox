use unicode_normalization::UnicodeNormalization;

use crate::types::{Address, MessageSummary};

/// Lowercase, without the combining accents NFD splits off.
pub(super) fn normalize(text: &str) -> String {
    text.nfd()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .collect::<String>()
        .to_lowercase()
}

fn names(addresses: &[Address]) -> impl Iterator<Item = &str> {
    addresses
        .iter()
        .flat_map(|a| a.name.as_deref().into_iter().chain([a.email.as_str()]))
}

pub(super) fn search_text(summary: &MessageSummary) -> String {
    let heading: Vec<&str> = [summary.subject.as_str()]
        .into_iter()
        .chain(names(&summary.from))
        .chain(names(&summary.to))
        .chain(names(&summary.cc))
        .collect();
    format!(
        "{}\n{}",
        normalize(&heading.join("\n")),
        normalize(&summary.preview)
    )
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn drops_accents_and_case() {
        assert_eq!(normalize("Élodie Müller"), "elodie muller");
    }
}
