use super::*;
use std::cell::RefCell;

#[derive(Default)]
struct Store {
    value: RefCell<Option<String>>,
    fail: bool,
}
impl CredentialStore for Store {
    fn load(&self) -> Result<Option<Credentials>, String> {
        Ok(self
            .value
            .borrow()
            .as_ref()
            .map(|json| serde_json::from_str(json).unwrap()))
    }
    fn save(&self, data: &Credentials) -> Result<(), String> {
        if self.fail {
            return Err("Store locked".into());
        }
        *self.value.borrow_mut() = Some(serde_json::to_string(data).unwrap());
        Ok(())
    }
}
fn credentials() -> Credentials {
    Credentials {
        client: ClientConfig {
            client_id: "test.apps.googleusercontent.com".into(),
            client_secret: "client-secret".into(),
        },
        tokens: Some(Tokens {
            access_token: "access".into(),
            refresh_token: "refresh".into(),
            expires_at: 100,
        }),
    }
}

#[test]
fn imports_only_desktop_configuration_and_never_uses_its_endpoints() {
    assert!(imported_client(br#"{"web":{"client_id":"x","client_secret":"secret"}}"#).is_err());
    assert!(imported_client(
        br#"{"installed":{"client_id":"https://evil","client_secret":"secret"}}"#
    )
    .is_err());
    let config = imported_client(br#"{"installed":{"client_id":"test.apps.googleusercontent.com","client_secret":"secret","token_uri":"https://evil.invalid","refresh_token":"untrusted"}}"#).unwrap();
    let encoded = serde_json::to_string(&config).unwrap();
    assert!(!encoded.contains("evil"));
    assert!(!encoded.contains("untrusted"));
}

#[test]
fn disconnect_removes_tokens_but_keeps_configuration_even_when_revocation_fails() {
    let store = Store::default();
    store.save(&credentials()).unwrap();
    let warning = disconnect(&store, |token| {
        assert_eq!(token, "refresh");
        false
    })
    .unwrap();
    assert!(warning.unwrap().contains("Disconnected locally"));
    let persisted = store.load().unwrap().unwrap();
    assert!(persisted.tokens.is_none());
    assert_eq!(
        persisted.client.client_id,
        "test.apps.googleusercontent.com"
    );
    let status = serde_json::to_string(&status(&store).unwrap()).unwrap();
    assert!(!status.contains("secret"));
    assert!(!status.contains("token"));
}

#[test]
fn failed_credential_deletion_does_not_claim_disconnection_or_revoke_first() {
    let mut store = Store::default();
    store.save(&credentials()).unwrap();
    store.fail = true;
    assert!(disconnect(&store, |_| panic!("must remove locally before revocation")).is_err());
    assert!(store.load().unwrap().unwrap().tokens.is_some());
}

#[test]
fn finalization_honors_cancellation_and_store_failure_before_claiming_connection() {
    let mut store = Store::default();
    let mut config_only = credentials();
    config_only.tokens = None;
    store.save(&config_only).unwrap();
    let tokens = credentials().tokens.unwrap();
    assert!(finish_authorization(
        &store,
        credentials(),
        &tokens,
        &Flow {
            active: true,
            cancelled: true
        }
    )
    .is_err());
    assert!(store.load().unwrap().unwrap().tokens.is_none());
    store.fail = true;
    assert!(finish_authorization(
        &store,
        credentials(),
        &tokens,
        &Flow {
            active: true,
            cancelled: false
        }
    )
    .is_err());
    assert!(store.load().unwrap().unwrap().tokens.is_none());
    store.fail = false;
    finish_authorization(
        &store,
        credentials(),
        &tokens,
        &Flow {
            active: true,
            cancelled: false,
        },
    )
    .unwrap();
    assert_eq!(
        store.load().unwrap().unwrap().tokens.unwrap().refresh_token,
        "refresh"
    );
}
