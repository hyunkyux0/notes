# Local Notes

A local-first Markdown notebook with planned Google Calendar review reminders.
The first milestone provides a runnable Tauri desktop shell; note storage, editing,
and calendar integration are not implemented yet.

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
There are no Rust behavior tests yet; the initial test command verifies the test
target builds. Feature tests will accompany storage and scheduling implementations.

## Structure

- `src/`: React interface and styles.
- `src-tauri/`: native desktop host; future file storage and integrations belong here.
- `docs/implementation-plan.md`: approved scope and review checkpoints.

Markdown files will remain the source of truth for note content; SQLite will hold
search and review state. Add feature modules when those features are implemented.
Personal vaults and credentials must live outside this repository.

See [CONTRIBUTING.md](CONTRIBUTING.md) for review conventions. Licensed under MIT.
