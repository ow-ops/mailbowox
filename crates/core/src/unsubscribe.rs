//! One-click unsubscription (RFC 8058): a POST to the list's https URL.

use io_http::{
    coroutine::{HttpCoroutine, HttpCoroutineState},
    rfc9110::{request::HttpRequest, send::HttpSendYield},
    rfc9112::send::Http11Send,
};
use url::Url;

use crate::{
    dav::USER_AGENT,
    error::CoreError,
    tls::{ANSWER_TIMEOUT, SecureStream},
    transport,
};

const BODY: &[u8] = b"List-Unsubscribe=One-Click";

pub(crate) async fn one_click(url: &str) -> Result<(), CoreError> {
    let url = Url::parse(url).map_err(CoreError::invalid)?;
    if url.scheme() != "https" {
        return Err(CoreError::invalid(
            "one-click unsubscription needs an https URL",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| CoreError::invalid("URL without a host"))?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| CoreError::invalid("URL without a port"))?;

    let mut coroutine = Http11Send::new(request(url.clone()));
    // The URL comes from whoever sent the message, so it may not point into the user's own network.
    let mut stream = SecureStream::connect(host, port, true, Some(transport::is_public)).await?;
    let mut buf = vec![0; transport::READ_CHUNK];
    let mut arg: Option<&[u8]> = None;
    let status = loop {
        match coroutine.resume(arg.take()) {
            HttpCoroutineState::Complete(result) => {
                break result.map_err(CoreError::protocol)?.response.status;
            }
            HttpCoroutineState::Yielded(HttpSendYield::WantsWrite(bytes)) => {
                stream.write_all(&bytes).await?;
            }
            HttpCoroutineState::Yielded(HttpSendYield::WantsRead) => {
                let n = stream.read_within(&mut buf, ANSWER_TIMEOUT).await?;
                arg = Some(transport::filled(&buf, n));
            }
            // The list took the request; where it sends a browser next does not matter here.
            HttpCoroutineState::Yielded(HttpSendYield::WantsRedirect { response, .. }) => {
                break response.status;
            }
        }
    };
    // The answer is already in hand; a failed close changes nothing.
    let _ = stream.close().await;
    if status.is_success() || status.is_redirection() {
        Ok(())
    } else {
        Err(CoreError::protocol(format!(
            "the list answered with status {}",
            *status
        )))
    }
}

fn request(url: Url) -> HttpRequest {
    HttpRequest {
        method: "POST".into(),
        url,
        headers: Vec::new(),
        body: BODY.to_vec(),
    }
    .header("Content-Type", "application/x-www-form-urlencoded")
    .header("User-Agent", USER_AGENT)
    .header("Connection", "close")
}

#[cfg(test)]
mod tests {
    use url::Url;

    use super::request;

    #[test]
    fn the_request_is_the_form_rfc_8058_asks_for() {
        let url = Url::parse("https://list.example/u?id=1").expect("a URL");
        let bytes = request(url).to_http_11_vec().expect("a request");
        let text = String::from_utf8(bytes).expect("ASCII");
        assert!(text.starts_with("POST /u?id=1 HTTP/1.1\r\n"), "{text}");
        assert!(text.contains("host: list.example\r\n"), "{text}");
        assert!(
            text.contains("Content-Type: application/x-www-form-urlencoded\r\n"),
            "{text}"
        );
        assert!(
            text.ends_with("\r\n\r\nList-Unsubscribe=One-Click"),
            "{text}"
        );
    }
}
