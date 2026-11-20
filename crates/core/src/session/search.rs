use io_imap::types::{
    core::{AString, Vec1},
    search::SearchKey,
};

use crate::error::CoreError;

/// Each word must appear in the sender, a recipient, the subject or the body.
/// `from:`, `to:`, `cc:` and `subject:` keep a word to that field; `is:unread`,
/// `is:read` and `is:starred` filter on flags.
pub(super) fn search_criteria(query: &str) -> Result<Vec1<SearchKey<'static>>, CoreError> {
    let keys = query
        .split_whitespace()
        .map(search_key)
        .collect::<Result<Vec<_>, CoreError>>()?;
    Vec1::try_from(keys).map_err(|_| CoreError::invalid("the search query is empty"))
}

fn search_key(word: &str) -> Result<SearchKey<'static>, CoreError> {
    let text = |value: &str| AString::try_from(value.to_owned()).map_err(CoreError::invalid);
    let either = |a, b| SearchKey::Or(Box::new(a), Box::new(b));
    if let Some((name, value)) = word.split_once(':')
        && !value.is_empty()
    {
        match (
            name.to_ascii_lowercase().as_str(),
            value.to_ascii_lowercase().as_str(),
        ) {
            ("from", _) => return Ok(SearchKey::From(text(value)?)),
            ("to", _) => {
                return Ok(either(
                    SearchKey::To(text(value)?),
                    SearchKey::Cc(text(value)?),
                ));
            }
            ("cc", _) => return Ok(SearchKey::Cc(text(value)?)),
            ("subject", _) => return Ok(SearchKey::Subject(text(value)?)),
            ("is", "unread") => return Ok(SearchKey::Unseen),
            ("is", "read") => return Ok(SearchKey::Seen),
            ("is", "starred" | "flagged") => return Ok(SearchKey::Flagged),
            _ => {}
        }
    }
    Ok(either(
        either(SearchKey::From(text(word)?), SearchKey::To(text(word)?)),
        either(
            SearchKey::Subject(text(word)?),
            SearchKey::Body(text(word)?),
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::{SearchKey, search_key};

    #[test]
    fn search_operators_keep_a_word_to_its_field_or_flag() {
        assert!(matches!(search_key("from:bob"), Ok(SearchKey::From(_))));
        assert!(matches!(
            search_key("Subject:invoice"),
            Ok(SearchKey::Subject(_))
        ));
        assert!(matches!(search_key("is:unread"), Ok(SearchKey::Unseen)));
        assert!(matches!(search_key("is:starred"), Ok(SearchKey::Flagged)));
        // An unknown operator, or one with no value, is searched as written.
        assert!(matches!(search_key("is:odd"), Ok(SearchKey::Or(..))));
        assert!(matches!(search_key("from:"), Ok(SearchKey::Or(..))));
    }
}
