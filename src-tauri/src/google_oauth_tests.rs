use super::*;

fn request(query: &str) -> String {
    format!("GET /oauth/callback?{query} HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n\r\n")
}
#[test]
fn callback_requires_matching_state_host_path_and_unambiguous_parameters() {
    assert_eq!(
        callback(
            &request("state=expected&code=secret"),
            "127.0.0.1:1234",
            "expected"
        )
        .unwrap()
        .unwrap(),
        "secret"
    );
    for query in [
        "state=wrong&code=secret",
        "code=secret",
        "state=expected&state=expected&code=secret",
        "state=expected&code=a&error=b",
        "state=expected&code=",
        "state=expected&code=a&iss=https://evil.invalid",
    ] {
        assert!(callback(&request(query), "127.0.0.1:1234", "expected").is_none());
    }
    for bad in [
        request("state=expected&code=a").replace("GET", "POST"),
        request("state=expected&code=a").replace("Host: 127.0.0.1:1234", "Host: evil.invalid"),
        request("state=expected&code=a").replace("/oauth/callback", "/other"),
    ] {
        assert!(callback(&bad, "127.0.0.1:1234", "expected").is_none());
    }
    assert!(callback(
        &request("state=expected&error=access_denied"),
        "127.0.0.1:1234",
        "expected"
    )
    .unwrap()
    .is_err());
}

#[test]
fn token_validation_requires_offline_access_and_rejects_unexpected_scopes() {
    for extra in [
        serde_json::json!({"scope":"broad", "refresh_token":"refresh"}),
        serde_json::json!({"scope":SCOPE}),
    ] {
        let mut json =
            serde_json::json!({"access_token":"access", "token_type":"Bearer", "expires_in":3600});
        json.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert!(token_record(serde_json::from_value(json).unwrap()).is_err());
    }
}

fn config() -> ClientConfig {
    ClientConfig {
        client_id: "test.apps.googleusercontent.com".into(),
        client_secret: "secret".into(),
    }
}

#[test]
fn loopback_flow_exchanges_the_exact_pkce_verifier_and_closes_callback() {
    // A local fake token endpoint, never Google or the OS credential store.
    let token_server = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/token", token_server.local_addr().unwrap());
    let (send, receive) = std::sync::mpsc::channel();
    let provider = std::thread::spawn(move || {
        let (mut stream, _) = token_server.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut b = [0; 1024];
        loop {
            let n = stream.read(&mut b).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&b[..n]);
            if let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = std::str::from_utf8(&bytes[..pos]).unwrap();
                let length: usize = head
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length: ")
                            .map(str::to_owned)
                    })
                    .unwrap()
                    .parse()
                    .unwrap();
                if bytes.len() >= pos + 4 + length {
                    break;
                }
            }
        }
        let request = String::from_utf8(bytes).unwrap();
        let form: HashMap<_, _> =
            url::form_urlencoded::parse(request.split_once("\r\n\r\n").unwrap().1.as_bytes())
                .into_owned()
                .collect();
        let (challenge, redirect): (String, String) = receive.recv().unwrap();
        let computed = PkceCodeChallenge::from_code_verifier_sha256(
            &oauth2::PkceCodeVerifier::new(form["code_verifier"].clone()),
        );
        assert_eq!(computed.as_str(), challenge);
        assert_eq!(form["redirect_uri"], redirect);
        assert_eq!(form["code"], "test-code");
        assert_eq!(form["client_id"], "test.apps.googleusercontent.com");
        let body = serde_json::json!({"access_token":"access", "refresh_token":"refresh", "expires_in":3600, "token_type":"Bearer", "scope":SCOPE}).to_string();
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(),body).unwrap();
        redirect
    });
    let tokens = authorize_with(
        &config(),
        || false,
        |authorization| {
            let url = Url::parse(authorization).unwrap();
            assert_eq!(url.host_str(), Some("accounts.google.com"));
            let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
            assert_eq!(query["scope"], SCOPE);
            assert_eq!(query["code_challenge_method"], "S256");
            let redirect = Url::parse(&query["redirect_uri"]).unwrap();
            send.send((query["code_challenge"].clone(), redirect.to_string()))
                .unwrap();
            std::thread::spawn(move || {
                let host = format!("127.0.0.1:{}", redirect.port().unwrap());
                let mut stream = TcpStream::connect(&host).unwrap();
                write!(
                    stream,
                    "GET /oauth/callback?state={}&code=test-code HTTP/1.1\r\nHost: {host}\r\n\r\n",
                    query["state"]
                )
                .unwrap();
            });
            Ok(())
        },
        &endpoint,
        Duration::from_secs(5),
    )
    .unwrap();
    assert_eq!(tokens.refresh_token, "refresh");
    let redirect = Url::parse(&provider.join().unwrap()).unwrap();
    assert!(TcpStream::connect(("127.0.0.1", redirect.port().unwrap())).is_err());
}

#[test]
fn cancelled_or_timed_out_flows_do_not_exchange_credentials() {
    assert!(authorize_with(
        &config(),
        || true,
        |_| panic!("cancelled before opening browser"),
        "http://127.0.0.1:1",
        Duration::from_secs(1)
    )
    .err()
    .unwrap()
    .contains("cancelled"));
    assert!(authorize_with(
        &config(),
        || false,
        |_| Ok(()),
        "http://127.0.0.1:1",
        Duration::ZERO
    )
    .err()
    .unwrap()
    .contains("timed out"));
}
