# Local Notes

A local-first Markdown notebook with planned Google Calendar review reminders.
The desktop app can select a local notes folder and remember it across restarts.
Note creation, editing, and calendar integration are not implemented yet.

## Development

Install Node.js 24, a stable Rust toolchain, and the
[Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).
On macOS, this includes Xcode Command Line Tools. Ensure `cargo` and `rustc` are on PATH.

```sh
npm ci
npm run desktop:dev
```

Use `npm run dev` for the browser-only UI preview. To check and compile:

```sh
npm run check
npm run desktop:build
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
```

The build currently produces a native executable in `src-tauri/target/release/`.
Installers, signing, and notarization come in the release milestone.
Rust tests cover vault validation, settings persistence, cancellation, and recovery
from missing folders, corrupt settings, and failed saves.

## Choose a vault

In Notebook or Settings, choose a folder using the native picker. Its canonical
absolute path is stored in `vault.json` in Tauri's application configuration folder
(on macOS, `~/Library/Application Support/io.github.hyunkyux0.notes/`). Canceling
keeps the current selection. Existing folder contents are not modified.
If a saved folder becomes unavailable, reconnect it and restart, or choose another.
The browser preview cannot select local folders.

## Structure

- `src/`: React interface and styles.
- `src/vault/`: vault selection interface.
- `src-tauri/src/vault.rs`: folder validation and atomic settings persistence.
- `src-tauri/src/vault_commands.rs`: native picker and desktop command boundary.
- `docs/implementation-plan.md`: approved scope and review checkpoints.

Markdown files will remain the source of truth for note content; SQLite will hold
search and review state. Add feature modules when those features are implemented.
Personal vaults and credentials must live outside this repository.

See [CONTRIBUTING.md](CONTRIBUTING.md) for review conventions. Licensed under MIT.
