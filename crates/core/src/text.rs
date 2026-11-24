//! The text part of a formatted message, for mail clients that show only
//! text: a line per block, `> ` before quoted lines, a dash or number before
//! list items and the address after a link's words.

use std::cell::RefCell;

use html5ever::tendril::StrTendril;
use html5ever::tokenizer::states::RawKind;
use html5ever::tokenizer::{
    BufferQueue, Tag, TagKind, Token, TokenSink, TokenSinkResult, Tokenizer, TokenizerOpts,
};

const BLOCKS: [&str; 14] = [
    "p",
    "div",
    "li",
    "tr",
    "table",
    "ul",
    "ol",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
];

/// Elements whose content is not part of the text.
const HIDDEN: [&str; 4] = ["head", "style", "script", "title"];

/// Hidden elements whose content is text, not markup.
const RAW: [&str; 3] = ["style", "script", "title"];

#[derive(Default)]
struct Tokens(RefCell<Vec<Token>>);

impl TokenSink for Tokens {
    type Handle = ();

    fn process_token(&self, token: Token, _line: u64) -> TokenSinkResult<()> {
        // Without a tree builder the tokenizer reads a style or script as
        // markup unless told; told, a `<` inside it stays text.
        let raw = matches!(&token, Token::TagToken(tag)
            if tag.kind == TagKind::StartTag && RAW.contains(&&*tag.name));
        self.0.borrow_mut().push(token);
        if raw {
            TokenSinkResult::RawData(RawKind::Rawtext)
        } else {
            TokenSinkResult::Continue
        }
    }
}

#[derive(Default)]
struct Text {
    lines: Vec<String>,
    line: String,
    /// A list item's dash or number, then the spaces that line up its
    /// next lines.
    marker: String,
    quotes: usize,
    hidden: usize,
    /// Each open list: 0 for dashes, else the next item's number.
    lists: Vec<u32>,
    /// A link's address and where its words start in the line.
    link: Option<(String, usize)>,
}

impl Text {
    fn flush(&mut self, always: bool) {
        if self.line.is_empty() && !always {
            return;
        }
        let line = std::mem::take(&mut self.line);
        // The editor drops a trailing space, so it writes the separator's
        // with a no-break one; mail clients look for a plain one.
        self.lines.push(if line == "--\u{a0}" && self.quotes == 0 {
            "-- ".to_owned()
        } else {
            format!("{}{}{line}", "> ".repeat(self.quotes), self.marker)
                .trim_end()
                .to_owned()
        });
        self.marker = " ".repeat(self.marker.chars().count());
    }

    fn characters(&mut self, text: &str) {
        if self.hidden > 0 {
            return;
        }
        for character in text.chars() {
            if character.is_ascii_whitespace() {
                if !self.line.is_empty() && !self.line.ends_with(' ') {
                    self.line.push(' ');
                }
            } else {
                self.line.push(character);
            }
        }
    }

    fn tag(&mut self, tag: &Tag) {
        let name = &*tag.name;
        let start = tag.kind == TagKind::StartTag;
        if HIDDEN.contains(&name) {
            self.hidden = if start {
                self.hidden.saturating_add(1)
            } else {
                self.hidden.saturating_sub(1)
            };
        } else if name == "br" {
            self.flush(true);
        } else if name == "a" {
            if start {
                self.link = tag
                    .attrs
                    .iter()
                    .find(|attribute| &*attribute.name.local == "href")
                    .map(|attribute| (attribute.value.to_string(), self.line.len()));
            } else if let Some((href, from)) = self.link.take() {
                let words = self.line.get(from..).unwrap_or_default().trim();
                if words != href.trim_start_matches("mailto:") {
                    self.line.push_str(" <");
                    self.line.push_str(&href);
                    self.line.push('>');
                }
            }
        } else if BLOCKS.contains(&name) {
            self.flush(false);
            match (name, start) {
                ("blockquote", true) => self.quotes = self.quotes.saturating_add(1),
                ("blockquote", false) => self.quotes = self.quotes.saturating_sub(1),
                ("ul", true) => self.lists.push(0),
                ("ol", true) => self.lists.push(1),
                ("ul" | "ol", false) => {
                    self.lists.pop();
                }
                ("li", _) => {
                    self.marker.clear();
                    if start {
                        let indent = "  ".repeat(self.lists.len().saturating_sub(1));
                        self.marker = match self.lists.last_mut() {
                            Some(number) if *number > 0 => {
                                let marker = format!("{indent}{number}. ");
                                *number = number.saturating_add(1);
                                marker
                            }
                            _ => format!("{indent}- "),
                        };
                    }
                }
                _ => {}
            }
        }
    }
}

pub(crate) fn html_to_text(html: &str) -> String {
    let input = BufferQueue::default();
    input.push_back(StrTendril::from(html));
    let tokenizer = Tokenizer::new(Tokens::default(), TokenizerOpts::default());
    // The sink never pauses the tokenizer for a script, so feeding finishes.
    let _done = tokenizer.feed(&input);
    tokenizer.end();
    let mut text = Text::default();
    for token in tokenizer.sink.0.take() {
        match token {
            Token::CharacterTokens(characters) => text.characters(&characters),
            Token::TagToken(tag) => text.tag(&tag),
            _ => {}
        }
    }
    text.flush(false);
    text.lines.join("\n").trim_end().to_owned()
}

#[cfg(test)]
mod tests {
    use super::html_to_text;

    #[test]
    fn writes_the_signature_separator_mail_clients_look_for() {
        assert_eq!(
            html_to_text("<br><p>--&nbsp;</p><p>Alice</p>"),
            "\n-- \nAlice"
        );
    }

    #[test]
    fn puts_a_link_address_after_its_words() {
        assert_eq!(
            html_to_text(
                r#"<p>Read the <a href="https://example.org/docs">docs</a>, or <a href="https://example.org">https://example.org</a></p>"#
            ),
            "Read the docs <https://example.org/docs>, or https://example.org"
        );
    }

    #[test]
    fn marks_quoted_lines_and_list_items() {
        assert_eq!(
            html_to_text(concat!(
                "<p>Sure.</p><br><p>Bob wrote:</p>",
                "<blockquote><p>Bring:</p><ul><li><p>bread</p></li><li>wine</li></ul>",
                "<blockquote><p>older</p></blockquote></blockquote>",
                "<ol><li>one</li><li>two</li></ol>"
            )),
            "Sure.\n\nBob wrote:\n> Bring:\n> - bread\n> - wine\n> > older\n1. one\n2. two"
        );
    }

    #[test]
    fn leaves_out_styles_scripts_and_comments_of_a_quoted_original() {
        assert_eq!(
            html_to_text(concat!(
                "<html><head><style>p > a { color: red }</style></head><body>",
                "<!-- x --><script>if (a < b) {}</script><p>Hi&nbsp;&amp; bye</p></body></html>"
            )),
            "Hi\u{a0}& bye"
        );
    }

    #[test]
    fn reads_an_attribute_holding_a_closing_bracket() {
        assert_eq!(html_to_text(r#"<p title="a > b">Hi</p>"#), "Hi");
    }
}
