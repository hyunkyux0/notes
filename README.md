# Local Notes

A local-first Markdown notebook with planned Google Calendar review reminders.
The desktop app remembers a local notes folder, creates Markdown notes, and lists
and reads existing notes. Editing and calendar integration are not implemented yet.

## Development

Install Node.js 24, a stable Rust toolchain, and the
[Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).
On macOS, this includes Xcode Command Line Tools. Ensure `cargo` and `rustc` are on PATH.

On macOS/Linux, install Rust using the [official rustup instructions](https://rust-lang.org/tools/install/),
then open a new terminal or run `. "$HOME/.cargo/env"`. Verify the tools in the
same terminal you will use for development:

```sh
cargo --version
rustc --version
```

If `cargo` is not found or Tauri fails to run `cargo metadata` with “No such file
or directory”, Rust is missing or its command directory is not on PATH. If
`~/.cargo/env` exists, source it as above; otherwise install/repair rustup first.
For zsh, add `. "$HOME/.cargo/env"` to `~/.zshrc` if new terminals still cannot find
Cargo. A toolchain directory under `~/.rustup` alone does not establish this setup.

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
from missing folders, corrupt settings, and failed saves. Note tests cover stable
IDs, filename collisions, existing-file preservation, and invalid paths/content.

## Choose a vault

In Notebook or Settings, choose a folder using the native picker. Its canonical
absolute path is stored in `vault.json` in Tauri's application configuration folder
(on macOS, `~/Library/Application Support/io.github.hyunkyux0.notes/`). Canceling
keeps the current selection. Existing folder contents are not modified.
If a saved folder becomes unavailable, reconnect it and restart, or choose another.
The browser preview cannot select local folders.

## Create and read notes

In Notebook, enter a title and select Create note. The file contains a heading and
a `<!-- local-notes-id: UUID -->` first line, which preserves its identity when
renamed or moved with its content intact. Filenames use a sanitized title plus UUID;
repeated titles create separate files. Existing files are never replaced.

The list currently includes regular `.md` files directly in the vault, with a
read-only plain-text view (UTF-8, up to 2 MiB). Use Refresh notes after external
changes. Subfolders, editing, and rendered previews come later. Existing Markdown
without our ID comment is readable and remains unchanged; no ID is assigned on read.
If a new-file write fails partway through, its incomplete file may remain; the app
reports this so you can inspect it before retrying.

## Structure

- `src/`: React interface and styles.
- `src/vault/`: vault selection interface.
- `src/notes/`: note creation, file list, and read-only view.
- `src-tauri/src/notes.rs`: Markdown storage scoped to an open vault directory.
- `src-tauri/src/note_commands.rs`: shared vault validation and async command adapter.
- `src-tauri/src/app_settings.rs`: application settings location shared by commands.
- `src-tauri/src/vault.rs`: folder validation and atomic settings persistence.
- `src-tauri/src/vault_commands.rs`: native picker and desktop command boundary.
- `docs/implementation-plan.md`: approved scope and review checkpoints.

Markdown files will remain the source of truth for note content; SQLite will hold
search and review state. Add feature modules when those features are implemented.
Personal vaults and credentials must live outside this repository.

See [CONTRIBUTING.md](CONTRIBUTING.md) for review conventions. Licensed under MIT.
