//! Browser OAuth only: no Calendar resource calls and no tokens returned to the WebView.
use super::{ClientConfig, Tokens};
use oauth2::{
    basic::{BasicClient, BasicTokenResponse, BasicTokenType},
    AuthType, AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;
use url::Url;

pub const SCOPE: &str = "https://www.googleapis.com/auth/calendar.app.created";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const CANCELLED: &str = "Google sign-in cancelled.";

fn http_client() -> Result<oauth2::reqwest::blocking::Client, String> {
    oauth2::reqwest::blocking::Client::builder()
        .redirect(oauth2::reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Could not initialize secure Google connection.".into())
}

pub fn authorize(config: &ClientConfig, cancelled: impl Fn() -> bool) -> Result<Tokens, String> {
    authorize_with(
        config,
        cancelled,
        |url| webbrowser::open(url).map_err(|_| "Could not open the browser.".into()),
        TOKEN_URL,
        Duration::from_secs(300),
    )
}

// The endpoint/opener are injected only by native tests, never through IPC or imported JSON.
fn authorize_with(
    config: &ClientConfig,
    cancelled: impl Fn() -> bool,
    browser: impl FnOnce(&str) -> Result<(), String>,
    endpoint: &str,
    timeout: Duration,
) -> Result<Tokens, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "Could not open the local sign-in callback.")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Could not initialize the local callback.")?;
    let host = listener
        .local_addr()
        .map_err(|_| "Local callback address unavailable.")?
        .to_string();
    let redirect = format!("http://{host}/oauth/callback");
    let client = BasicClient::new(ClientId::new(config.client_id.clone()))
        .set_client_secret(ClientSecret::new(config.client_secret.clone()))
        .set_auth_type(AuthType::RequestBody)
        .set_auth_uri(AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".into()).unwrap())
        .set_token_uri(
            TokenUrl::new(endpoint.into()).map_err(|_| "Invalid Google token endpoint.")?,
        )
        .set_redirect_uri(RedirectUrl::new(redirect).map_err(|_| "Invalid loopback redirect.")?);
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let (url, state) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new(SCOPE.into()))
        .set_pkce_challenge(challenge)
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent select_account")
        .url();
    if cancelled() {
        return Err(CANCELLED.into());
    }
    browser(url.as_str())?;
    let deadline = Instant::now() + timeout;
    let code = loop {
        if cancelled() {
            return Err(CANCELLED.into());
        }
        if Instant::now() >= deadline {
            return Err("Google sign-in timed out. Try again.".into());
        }
        match listener.accept() {
            Ok((mut stream, peer)) if peer.ip().is_loopback() => {
                let result = read_request(&mut stream)
                    .and_then(|request| callback(&request, &host, state.secret()));
                // Never echo the URL, authorization code, or provider-supplied text.
                let status = if result.is_some() {
                    "200 OK"
                } else {
                    "400 Bad Request"
                };
                let _ = stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n\r\nReturn to Local Notes for the sign-in result.").as_bytes());
                if let Some(code) = result {
                    break code?;
                }
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(_) => return Err("The local sign-in callback failed.".into()),
        }
    };
    drop(listener); // One matching callback, then no further replay is accepted.
    if cancelled() {
        return Err(CANCELLED.into());
    }
    let response = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(verifier)
        .request(&http_client()?)
        .map_err(|_| {
            "Google could not complete sign-in. Check the client configuration and try again."
        })?;
    token_record(response)
}

fn read_request(stream: &mut TcpStream) -> Option<String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(200)))
        .ok()?;
    stream
        .set_write_timeout(Some(Duration::from_millis(200)))
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(1);
    let mut bytes = Vec::new();
    let mut buffer = [0; 1024];
    while bytes.len() < 8192 && Instant::now() < deadline {
        let size = stream.read(&mut buffer).ok()?;
        if size == 0 {
            return None;
        }
        bytes.extend_from_slice(&buffer[..size]);
        if bytes.ends_with(b"\r\n\r\n") {
            return String::from_utf8(bytes).ok();
        }
    }
    None
}

fn callback(request: &str, host: &str, state: &str) -> Option<Result<String, String>> {
    let mut lines = request.split("\r\n");
    let first: Vec<_> = lines.next()?.split_whitespace().collect();
    if first.len() != 3 || first[0] != "GET" || !["HTTP/1.1", "HTTP/1.0"].contains(&first[2]) {
        return None;
    }
    let hosts: Vec<_> = lines
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("host"))
        .collect();
    if hosts.len() != 1 || hosts[0].1.trim() != host || !first[1].starts_with("/oauth/callback?") {
        return None;
    }
    let url = Url::parse(&format!("http://{host}{}", first[1])).ok()?;
    if url.path() != "/oauth/callback" || url.fragment().is_some() {
        return None;
    }
    let mut query = HashMap::new();
    for (key, value) in url.query_pairs() {
        if query.insert(key.into_owned(), value.into_owned()).is_some() {
            return None;
        }
    }
    if !bool::from(query.get("state")?.as_bytes().ct_eq(state.as_bytes())) {
        return None;
    }
    if query
        .get("iss")
        .is_some_and(|issuer| issuer != "https://accounts.google.com")
    {
        return None;
    }
    match (query.get("code"), query.get("error")) {
        (Some(code), None) if !code.is_empty() => Some(Ok(code.clone())),
        (None, Some(_)) => Some(Err(
            "Google sign-in was declined or could not be authorized.".into(),
        )),
        _ => None,
    }
}

fn token_record(response: BasicTokenResponse) -> Result<Tokens, String> {
    if response.token_type() != &BasicTokenType::Bearer
        || response.access_token().secret().is_empty()
        || response
            .scopes()
            .is_some_and(|scopes| scopes.len() != 1 || scopes[0].as_str() != SCOPE)
    {
        return Err("Google did not grant the expected Calendar permission.".into());
    }
    let refresh_token = response.refresh_token().filter(|token| !token.secret().is_empty())
        .ok_or("Google did not return offline access. Disconnect the app in your Google account and try again.")?;
    let expires = response
        .expires_in()
        .filter(|ttl| !ttl.is_zero())
        .ok_or("Google returned an invalid token lifetime.")?;
    let expires_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Check your system clock.")?
        .as_secs()
        .checked_add(expires.as_secs())
        .ok_or("Google returned an invalid token lifetime.")?;
    Ok(Tokens {
        access_token: response.access_token().secret().clone(),
        refresh_token: refresh_token.secret().clone(),
        expires_at,
    })
}

pub fn revoke(token: &str) -> bool {
    http_client()
        .and_then(|http| {
            http.post(REVOKE_URL)
                .form(&[("token", token)])
                .send()
                .map(|response| response.status().is_success())
                .map_err(|_| "Revocation failed.".into())
        })
        .unwrap_or(false)
}

#[cfg(test)]
#[path = "google_oauth_tests.rs"]
mod tests;
