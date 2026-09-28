//! Credentials stay in the OS store; IPC exposes only configuration/connection status.
use serde::{Deserialize, Serialize};
use std::{io::Read, sync::Mutex};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[path = "google_oauth.rs"]
mod oauth;

#[derive(Clone, Deserialize, Serialize)]
struct ClientConfig {
    client_id: String,
    client_secret: String,
}
#[derive(Clone, Deserialize, Serialize)]
struct Tokens {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
}
#[derive(Deserialize, Serialize)]
struct Credentials {
    client: ClientConfig,
    tokens: Option<Tokens>,
}
#[derive(Serialize)]
pub struct ConnectionStatus {
    configured: bool,
    connected: bool,
    connecting: bool,
}

trait CredentialStore {
    fn load(&self) -> Result<Option<Credentials>, String>;
    fn save(&self, value: &Credentials) -> Result<(), String>;
}
struct Keychain(keyring::Entry);
impl Keychain {
    fn new(app: &AppHandle) -> Result<Self, String> {
        keyring::Entry::new(
            &format!("{}.google-oauth", app.config().identifier),
            "connection",
        )
        .map(Self)
        .map_err(|_| "The OS credential store is unavailable.".into())
    }
}
impl CredentialStore for Keychain {
    fn load(&self) -> Result<Option<Credentials>, String> {
        match self.0.get_password() {
            Ok(value) => serde_json::from_str(&value).map(Some).map_err(|_| {
                "Saved Google credentials are invalid. Restore the OS credential entry.".into()
            }),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(
                "Could not read Google credentials from the OS store. Unlock it and retry.".into(),
            ),
        }
    }
    fn save(&self, value: &Credentials) -> Result<(), String> {
        let data =
            serde_json::to_string(value).map_err(|_| "Could not encode Google credentials.")?;
        self.0.set_password(&data).map_err(|_| {
            "Could not save Google credentials in the OS store. Unlock it and retry.".into()
        })
    }
}

// Only one configure/connect/disconnect operation may run across all windows.
static OPERATION: Mutex<()> = Mutex::new(());
#[derive(Default)]
struct Flow {
    active: bool,
    cancelled: bool,
}
static FLOW: Mutex<Flow> = Mutex::new(Flow {
    active: false,
    cancelled: false,
});
struct ActiveFlow;
impl Drop for ActiveFlow {
    fn drop(&mut self) {
        if let Ok(mut flow) = FLOW.lock() {
            flow.active = false;
        }
    }
}
fn cancelled() -> bool {
    FLOW.lock().map(|flow| flow.cancelled).unwrap_or(true)
}
fn status(store: &impl CredentialStore) -> Result<ConnectionStatus, String> {
    let data = store.load()?;
    Ok(ConnectionStatus {
        configured: data.is_some(),
        connected: data.is_some_and(|data| data.tokens.is_some()),
        connecting: FLOW.lock().map(|flow| flow.active).unwrap_or(false),
    })
}

fn imported_client(bytes: &[u8]) -> Result<ClientConfig, String> {
    #[derive(Deserialize)]
    struct Download {
        installed: ClientConfig,
    }
    let download: Download = serde_json::from_slice(bytes)
        .map_err(|_| "Choose the downloaded JSON for a Google Desktop app OAuth client.")?;
    let config = download.installed;
    let prefix = config
        .client_id
        .strip_suffix(".apps.googleusercontent.com")
        .filter(|prefix| {
            !prefix.is_empty()
                && prefix
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        });
    if prefix.is_none()
        || config.client_id.len() > 256
        || config.client_secret.is_empty()
        || config.client_secret.len() > 512
        || config.client_secret.chars().any(char::is_whitespace)
    {
        return Err("The Desktop app client configuration is invalid.".into());
    }
    Ok(config) // Imported endpoint/redirect fields are deliberately ignored.
}

#[tauri::command]
pub async fn get_google_connection(app: AppHandle) -> Result<ConnectionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status(&Keychain::new(&app)?))
        .await
        .map_err(|_| "Loading Google connection was interrupted.")?
}

#[tauri::command]
pub async fn import_google_client(app: AppHandle) -> Result<ConnectionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = OPERATION
            .try_lock()
            .map_err(|_| "Another Google connection action is running.")?;
        let store = Keychain::new(&app)?;
        if store.load()?.is_some_and(|data| data.tokens.is_some()) {
            return Err("Disconnect Google before replacing its client configuration.".into());
        }
        let file = app
            .dialog()
            .file()
            .add_filter("Google OAuth client", &["json"])
            .blocking_pick_file();
        if let Some(file) = file {
            let path = file
                .into_path()
                .map_err(|_| "Choose a local client JSON file.")?;
            let file =
                std::fs::File::open(path).map_err(|_| "Could not read the client JSON file.")?;
            let mut bytes = Vec::new();
            file.take(65537)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read the client JSON file.")?;
            if bytes.len() > 65536 {
                return Err("The client JSON file is too large.".into());
            }
            store.save(&Credentials {
                client: imported_client(&bytes)?,
                tokens: None,
            })?;
        }
        status(&store)
    })
    .await
    .map_err(|_| "Importing Google configuration was interrupted.")?
}

#[tauri::command]
pub async fn connect_google(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = OPERATION
            .try_lock()
            .map_err(|_| "Another Google connection action is running.")?;
        let store = Keychain::new(&app)?;
        let data = store
            .load()?
            .ok_or("Import a Desktop app OAuth client JSON first.")?;
        if data.tokens.is_some() {
            return Err("Google is already connected. Disconnect before signing in again.".into());
        }
        *FLOW.lock().map_err(|_| "Google sign-in is unavailable.")? = Flow {
            active: true,
            cancelled: false,
        };
        let _active = ActiveFlow;
        let tokens = oauth::authorize(&data.client, cancelled)?;
        // Serialize cancellation with the final OS-store write: a cancelled flow cannot
        // later overwrite credentials. Disconnect also waits for this operation to finish.
        let result = {
            let flow = FLOW.lock().map_err(|_| "Google sign-in is unavailable.")?;
            finish_authorization(&store, data, &tokens, &flow)
        };
        if result.is_err() {
            oauth::revoke(&tokens.refresh_token);
        }
        result
    })
    .await
    .map_err(|_| "Google sign-in was interrupted.")?
}

fn finish_authorization(
    store: &impl CredentialStore,
    mut data: Credentials,
    tokens: &Tokens,
    flow: &Flow,
) -> Result<(), String> {
    if !flow.active || flow.cancelled {
        return Err("Google sign-in cancelled.".into());
    }
    data.tokens = Some(tokens.clone());
    store.save(&data)
}

#[tauri::command]
pub fn cancel_google_sign_in() {
    if let Ok(mut flow) = FLOW.lock() {
        flow.cancelled = true;
    }
}

fn disconnect(
    store: &impl CredentialStore,
    revoke: impl FnOnce(&str) -> bool,
) -> Result<Option<String>, String> {
    let Some(mut data) = store.load()? else {
        return Ok(None);
    };
    let tokens = data.tokens.take();
    store.save(&data)?; // Local credentials must be removed even if the network is offline.
    Ok(tokens.filter(|tokens| !revoke(&tokens.refresh_token)).map(|_| {
        "Disconnected locally. Google revocation could not be confirmed; remove Local Notes access in your Google account permissions.".into()
    }))
}

#[tauri::command]
pub async fn disconnect_google(app: AppHandle) -> Result<Option<String>, String> {
    cancel_google_sign_in();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = OPERATION
            .lock()
            .map_err(|_| "Google connection is unavailable.")?;
        disconnect(&Keychain::new(&app)?, oauth::revoke)
    })
    .await
    .map_err(|_| "Disconnecting Google was interrupted.")?
}

#[cfg(test)]
#[path = "google_connection_tests.rs"]
mod tests;
