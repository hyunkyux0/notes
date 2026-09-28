# Google account connection

This checkpoint connects and disconnects a Google account. It does not create
calendars/events, deliver reviews, or send notifications. Existing notes and local
review schedules are unaffected.

## Configure your own Desktop OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/), select/create a
   project, and enable the Google Calendar API.
2. Configure Google Auth Platform branding and audience. During testing, add your
   Google account as a test user if required by the chosen audience.
3. Create an OAuth client with application type **Desktop app**, then download its
   JSON. Keep that download outside this repository and your note vault.
4. In the desktop app, open Settings → **Import Google client JSON** and select the
   downloaded file. Web application client JSON is rejected. Canceling or importing
   invalid JSON leaves the previous configuration intact.
5. Choose **Connect Google**, complete consent in your normal browser, and return
   to Local Notes. The app reports **Google credentials saved on this device** only
   after the OS credential store accepts the tokens.

The client configuration is required; this repository ships without one. See
[Google's desktop OAuth setup](https://developers.google.com/identity/protocols/oauth2/native-app).
The requested scope is only `https://www.googleapis.com/auth/calendar.app.created`,
which supports a future app-created review calendar without requesting access to
all existing calendars. See [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

Configuration and tokens are held in one OS credential entry, under service
`<application identifier>.google-oauth`, account `connection`: macOS Keychain,
Windows Credential Manager, or Linux Secret Service (an unlocked desktop service
must be available). There is no plaintext fallback. Markdown, SQLite, browser
storage, IPC responses, and application logs never receive OAuth tokens. The
original downloaded JSON is not deleted by importing it; manage that file yourself.
The separate review app uses `io.github.hyunkyux0.notes.review`, so its credentials
are independent of the normal app's `io.github.hyunkyux0.notes` entry.

## Sign-in and disconnection behavior

The native backend opens the system browser and uses PKCE S256 plus random state.
It binds only `127.0.0.1` on an available port before opening the browser. A callback
must match its host, path, and state; duplicate parameters are rejected. One valid
callback closes the listener. Imported endpoint URLs are ignored, token requests
use fixed Google HTTPS endpoints, and HTTP redirects are disabled.

Sign-in expires after five minutes or can be canceled from Settings. Closing
Settings does not cancel it; reopen Settings to see progress. Connection actions
are serialized across windows. A canceled attempt cannot subsequently commit tokens.
Errors show a retryable explanation without exposing provider responses or codes.
If credential storage fails after authorization, the app attempts to revoke the
new grant; that cleanup cannot be guaranteed when offline.

**Disconnect Google** removes local tokens first, retains the imported client for
reconnection, and attempts Google revocation. If revocation fails, a warning asks
you to remove access through your Google account's app permissions. If the OS
store cannot remove tokens, the app reports failure and keeps the connected state.
Disconnect before replacing the imported client or changing accounts.

The saved-credentials status is local, not proof of a currently valid Google grant.
Token refresh and handling revoked/expired grants during Calendar operations belong
to the next checkpoint. If the OS store is locked, unlock it and retry. Malformed
credential entries are reported rather than silently overwritten; restore or remove
the app's entry with your OS credential tool, then reimport and reconnect.

## Verify this checkpoint

```sh
npm run check
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
npm run test:ui
npm run desktop:build
```

Rust tests use an in-memory credential store and a local fake token server: they
check PKCE exchange, callback validation/replay prevention, timeout/cancellation,
token validation, failed writes, and local disconnection when revocation fails.
Browser tests mock native commands and cover configuration, cancel/retry,
connection status after reload, and disconnect warnings. These tests do not prove
Google consent, native file picking, or real OS credential persistence works.

For a live check, run the desktop review app, import your Desktop client JSON,
cancel one sign-in, then connect successfully. Reopen Settings in another window
and restart the app: saved status should persist. Verify your note/draft and local
schedules remain intact, then disconnect and verify status after another restart.
Confirm that no review calendar or event was created. Live sign-in requires user
configuration and has not been verified by the automated tests.
