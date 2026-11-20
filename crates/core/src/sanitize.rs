//! HTML cleaning for the reader. Messages render in a sandbox without
//! JavaScript, but the markup is cleaned anyway: no scripts, forms, event
//! handlers or URL-loading styles, and no remote resources unless the user
//! asked (remote images track opens).

use std::{
    borrow::Cow,
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
};

use ammonia::{Builder, UrlRelative};
use percent_encoding::percent_decode_str;
use url::Url;

pub struct Sanitized {
    pub html: String,
    pub has_remote_content: bool,
    pub blocked_remote: u32,
}

#[cfg(test)]
pub fn sanitize_html(html: &str, allow_remote: bool) -> Sanitized {
    sanitize_html_with(html, allow_remote, HashMap::new())
}

/// `inline` maps a Content-ID to the `data:` URL of that part; an image
/// that names one by `cid:` gets it as its source. Nothing else in the
/// markup can carry a `data:` URL.
pub fn sanitize_html_with(
    html: &str,
    allow_remote: bool,
    inline: HashMap<String, String>,
) -> Sanitized {
    let remote = Arc::new(AtomicU32::new(0));
    let seen = remote.clone();

    let html = Builder::default()
        .add_generic_attributes(["style", "background", "bgcolor", "align", "valign"])
        .add_tag_attributes("img", ["srcset"])
        .add_url_schemes(["cid"])
        .url_relative(UrlRelative::Custom(Box::new(network_path)))
        .attribute_filter(move |element, attribute, value| {
            if element == "img"
                && attribute == "src"
                && let Some(data) = inline_source(value, &inline)
            {
                return Some(data.to_owned().into());
            }
            filter_attribute(attribute, value, allow_remote, &seen)
        })
        .clean(html)
        .to_string();

    let remote = remote.load(Ordering::Relaxed);
    Sanitized {
        html,
        has_remote_content: remote > 0,
        blocked_remote: if allow_remote { 0 } else { remote },
    }
}

// Deny would drop a protocol-relative URL before the filter counts it as remote.
fn network_path(url: &str) -> Option<Cow<'_, str>> {
    url.starts_with("//")
        .then(|| Cow::Owned(format!("https:{url}")))
}

fn filter_attribute<'u>(
    attribute: &str,
    value: &'u str,
    allow_remote: bool,
    remote: &AtomicU32,
) -> Option<Cow<'u, str>> {
    let loads_remote = match attribute {
        "src" | "background" => is_remote_url(value),
        "srcset" => value.split(',').any(is_remote_url),
        "style" => {
            let lower = value.to_ascii_lowercase();
            if lower.contains("expression(") || lower.contains("javascript:") {
                return None;
            }
            // A backslash can spell either of them with CSS escapes.
            lower.contains("url(") || lower.contains("image-set(") || lower.contains('\\')
        }
        _ => false,
    };
    if !loads_remote {
        return Some(value.into());
    }
    remote.fetch_add(1, Ordering::Relaxed);
    allow_remote.then_some(value.into())
}

fn inline_source<'a>(value: &str, inline: &'a HashMap<String, String>) -> Option<&'a str> {
    let (scheme, id) = value.trim().split_once(':')?;
    if !scheme.eq_ignore_ascii_case("cid") {
        return None;
    }
    let id = percent_decode_str(id).decode_utf8().ok()?;
    inline.get(id.as_ref()).map(String::as_str)
}

/// Stands for the message itself, which has no address: a URL that resolves
/// to another host loads from the network.
const MESSAGE: &str = "https://message.invalid/";

/// Parsed as a browser parses it (the URL standard drops tabs, newlines and
/// surrounding control characters), so a URL can't be written to look local
/// here and still load there.
fn is_remote_url(value: &str) -> bool {
    let Ok(message) = Url::parse(MESSAGE) else {
        return true;
    };
    message.join(value).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https") && url.host_str() != message.host_str()
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{sanitize_html, sanitize_html_with};

    #[test]
    fn remote_urls_written_to_slip_past_a_prefix_check_are_blocked() {
        for src in [
            "ht\ttps://t.test/p.gif",
            "\u{1}https://t.test/p.gif",
            "https\n://t.test/p.gif",
            " //t.test/p.gif",
            "/\t/t.test/p.gif",
            "HTTP://t.test/p.gif",
        ] {
            let out = sanitize_html(&format!("<img src=\"{src}\">"), false);
            assert_eq!(out.blocked_remote, 1, "{src:?}");
            assert!(!out.html.contains("t.test"), "{src:?}: {}", out.html);
        }
        for style in [
            "background: image-set('https://t.test/p.gif' 1x)",
            "background: \\75rl(https://t.test/p.gif)",
        ] {
            let out = sanitize_html(&format!("<p style=\"{style}\">x</p>"), false);
            assert_eq!(out.blocked_remote, 1, "{style:?}");
            assert!(!out.html.contains("t.test"), "{style:?}: {}", out.html);
        }
    }

    #[test]
    fn local_and_inline_sources_are_not_remote() {
        for src in [
            "cid:logo",
            "data:image/png;base64,AAAA",
            "logo.png",
            "/logo.png",
            "#top",
        ] {
            assert_eq!(
                sanitize_html(&format!("<img src=\"{src}\">"), false).blocked_remote,
                0,
                "{src:?}"
            );
        }
    }

    #[test]
    fn an_image_named_by_content_id_gets_its_data() {
        let inline = HashMap::from([(
            "logo@example".to_owned(),
            "data:image/png;base64,AAAA".to_owned(),
        )]);
        let out = sanitize_html_with(
            r#"<img src="CID:logo@example"><img src="cid:other"><a href="data:text/html,x">x</a>"#,
            false,
            inline,
        );
        assert!(out.html.contains(r#"src="data:image/png;base64,AAAA""#));
        assert!(out.html.contains(r#"src="cid:other""#));
        assert!(!out.html.contains("data:text/html"));
        assert_eq!(out.blocked_remote, 0);
    }

    #[test]
    fn scripts_and_their_content_are_removed() {
        let out = sanitize_html("<p>hi</p><script>alert(1)</script>", false);
        assert_eq!(out.html, "<p>hi</p>");
    }

    #[test]
    fn event_handlers_are_removed() {
        let out = sanitize_html(r#"<p onclick="steal()">hi</p>"#, false);
        assert_eq!(out.html, "<p>hi</p>");
    }

    #[test]
    fn forms_are_unwrapped() {
        let out = sanitize_html(
            r#"<form action="https://evil.test"><input name="pw"><button>go</button></form>"#,
            true,
        );
        assert!(!out.html.contains("<form"));
        assert!(!out.html.contains("<input"));
        assert!(!out.html.contains("<button"));
    }

    #[test]
    fn remote_images_are_blocked_and_reported() {
        let out = sanitize_html(r#"<img src="https://t.test/pixel.gif" alt="x">"#, false);
        assert!(out.has_remote_content);
        assert_eq!(out.blocked_remote, 1);
        assert!(!out.html.contains("t.test"));
        assert!(out.html.contains(r#"alt="x""#));
    }

    #[test]
    fn remote_images_stay_when_allowed() {
        let out = sanitize_html(r#"<img src="https://t.test/a.png">"#, true);
        assert!(out.has_remote_content);
        assert_eq!(out.blocked_remote, 0);
        assert!(out.html.contains("https://t.test/a.png"));
    }

    #[test]
    fn protocol_relative_and_srcset_urls_count_as_remote() {
        let out = sanitize_html(
            r#"<img src="//t.test/a.png"><img srcset="a.png 1x, https://t.test/b.png 2x">"#,
            false,
        );
        assert!(out.has_remote_content);
        assert!(!out.html.contains("t.test"));
    }

    #[test]
    fn protocol_relative_images_are_counted_and_load_over_https_once_allowed() {
        let html = r#"<img src="//t.test/a.png">"#;
        let blocked = sanitize_html(html, false);
        assert_eq!(blocked.blocked_remote, 1);
        assert!(!blocked.html.contains("t.test"));
        let allowed = sanitize_html(html, true);
        assert!(allowed.html.contains(r#"src="https://t.test/a.png""#));
    }

    #[test]
    fn relative_urls_are_removed() {
        let out = sanitize_html(r#"<img src="a.png"><a href="/x">l</a>"#, true);
        assert_eq!(out.html, "<img><a rel=\"noopener noreferrer\">l</a>");
    }

    #[test]
    fn cid_images_are_kept() {
        let out = sanitize_html(r#"<img src="cid:logo@example">"#, false);
        assert!(!out.has_remote_content);
        assert_eq!(out.blocked_remote, 0);
        assert!(out.html.contains(r#"src="cid:logo@example""#));
    }

    #[test]
    fn styles_loading_urls_are_dropped() {
        let out = sanitize_html(
            r#"<p style="color: red">a</p><div style="background: url(https://t.test/x)">b</div>"#,
            false,
        );
        assert!(out.has_remote_content);
        assert!(out.html.contains("color: red"));
        assert!(!out.html.contains("t.test"));
    }

    #[test]
    fn background_attributes_are_remote_content() {
        let out = sanitize_html(
            r#"<table background="http://t.test/bg.png"></table>"#,
            false,
        );
        assert!(out.has_remote_content);
        assert!(!out.html.contains("t.test"));
    }

    #[test]
    fn every_blocked_load_is_counted() {
        let out = sanitize_html(
            r#"<img src="https://t.test/pixel.gif" width="1" height="1">
               <img srcset="https://t.test/logo.png 2x">
               <table background="http://t.test/bg.png"></table>
               <div style="background-image: url('https://t.test/x.png')">b</div>
               <img src="cid:inline@example">
               <a href="https://example.org">link</a>"#,
            false,
        );
        assert_eq!(out.blocked_remote, 4);
    }

    #[test]
    fn style_blocks_and_links_to_stylesheets_are_removed() {
        let out = sanitize_html(
            r#"<link rel="stylesheet" href="https://t.test/a.css"><style>p{}</style><p>x</p>"#,
            false,
        );
        assert_eq!(out.html, "<p>x</p>");
    }

    #[test]
    fn javascript_links_are_removed() {
        let out = sanitize_html(r#"<a href="javascript:alert(1)">x</a>"#, true);
        assert!(!out.html.contains("javascript"));
    }

    #[test]
    fn plain_links_are_kept_without_counting_as_remote() {
        let out = sanitize_html(r#"<a href="https://example.org">x</a>"#, false);
        assert!(!out.has_remote_content);
        assert!(out.html.contains(r#"href="https://example.org""#));
    }
}
