# Local Notes

A local-first Markdown notebook with planned Google Calendar review reminders.
The desktop app remembers a local notes folder, creates Markdown notes, and edits
them with autosave and conflict recovery. Calendar integration is not implemented yet.

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
npx playwright install chromium
npm run test:ui
```

The build currently produces a native executable in `src-tauri/target/release/`.
Installers, signing, and notarization come in the release milestone.
Rust tests cover vault validation, settings persistence, cancellation, and recovery
from missing folders, corrupt settings, and failed saves. Note tests cover stable
IDs, filename collisions, existing-file preservation, invalid paths/content, and
atomic saves/conflicts. UI tests use mocked desktop commands to check autosave,
draft recovery, and failure handling; they do not replace native interaction tests.

The independent [review scheduling core](docs/review-scheduling.md) also has Rust
tests for calendar-day offsets and daylight-saving transitions. Settings configure review preferences; local schedules are persisted on the first
nonempty content save after configuration. Calendar delivery is not connected yet.

## Choose a vault

Use **Open vault** at the top left to choose a folder with the native picker.
Once selected, click the vault name there to switch folders. Its canonical
absolute path is stored in `vault.json` in Tauri's application configuration folder
(on macOS, `~/Library/Application Support/io.github.hyunkyux0.notes/`). Canceling
keeps the current selection. Existing folder contents are not modified.
If a saved folder becomes unavailable, reconnect it and restart, or choose another.
The browser preview cannot select local folders.

## Create and edit notes

In Notebook, enter a title and select Create note. The file contains a heading and
a `<!-- local-notes-id: UUID -->` first line, which preserves its identity when
renamed or moved with its content intact. Filenames retain the title, including
spaces and Unicode (for example, `Test 1.md`).
Repeated titles use `Test 1 (2).md`, then `(3)`, and so on. Unsafe filename characters
become hyphens; leading/trailing dots and whitespace are removed, long names are
shortened, and reserved device names are prefixed with `_`. Existing files keep
their names and are never replaced. Stable IDs remain inside the Markdown.

The list includes regular `.md` files in the vault and its visible subfolders (UTF-8, up to 2 MiB),
plus files with recovery drafts, including deleted files. Use Refresh notes after
external changes. Symbolic links and hidden folders are skipped; folder depth is
limited to 32 levels. The CodeMirror editor highlights Markdown syntax, supports undo/redo and list
continuation, and wraps long lines. Live preview is the default: headings, emphasis, lists, links, and code are
formatted while Markdown syntax appears on the selected lines (or the enclosing
code block). **Source mode** exposes all Markdown without changing text, selection,
undo history, or drafts. Links are styled text; clicking edits them rather than
opening a URL. HTML stays literal text. Fence and setext delimiter lines keep their
line breaks for reliable cursor navigation. Equations use `$...$` on one line or root-level `$$...$$` display blocks (delimiters
may be on separate lines). Clicking a rendered equation, placing the cursor in it,
or enabling Source mode exposes the original LaTeX. Invalid or oversized expressions
remain visible as source with an edit tooltip. Inline delimiters cannot have inner
edge whitespace; escape currency dollar signs with `\$`. Code and unmatched math
remain literal. Display math in nested lists/quotes and other delimiter styles are
not yet supported. Tab moves focus out of the editor. Existing Markdown
without our ID comment keeps its format; editing does not insert an ID into it.
If a new-file write fails partway through, its incomplete file may remain; the app
reports this so you can inspect it before retrying.

Edits autosave after 750 ms without typing. The ID line is preserved outside the
editable text. Drafts are retained in this app's local WebView storage before an
edit is accepted, and reopened with the note after navigation or restart. A storage
failure pauses editing rather than accepting an unprotected change. Markdown is
the saved source of truth; drafts are recovery copies, not backups.

Saving compares the file with the version you opened. A conflict or save failure
retains the draft and pauses autosave. Copy any text you need before choosing
Reload disk version and confirming discard, or use Retry save for transient errors.
No filesystem watcher or automatic merge is implemented yet.

Safe replacement currently requires macOS/Linux and a filesystem supporting atomic
file exchange. If another editor replaces the file during saving, both versions are
preserved: your draft becomes the note, and the displaced version remains at the
`.notes-save-*.tmp` location named in the error. Inspect that file before continuing;
these recovery files are not automatically deleted. Ordinary successful saves clean
up their temporary file. Editors writing through an old, already-open file handle
after replacement do not participate in this conflict protocol.

To rename or move a saved note, enter its vault-relative path (including `.md`),
such as `courses/week1/algebra.md`, and select Rename or move note. Destination
folders must already exist. Use **New folder name** to create folders inside the
selected folder (one level at a time). Click a folder in the navigation tree to
select it; use its separate chevron to expand/collapse, or **Vault root** to select
the root. Expand **New folder** or **New note** above the tree to show creation
controls. New notes are
created in the selected folder. Empty folders remain visible; click a Markdown
file to open it. Use **Refresh notes** after external filesystem changes. Folder
rename, move, and deletion are not implemented yet.

Drag the sidebar edge (or focus it and use left/right arrow keys) to resize it.
The top toolbar toggles sidebar visibility and opens Settings through the gear.
Reviews stays at the bottom left. Settings, Reviews, and sidebar collapse keep the
editor mounted so pending saves continue. Sidebar width/visibility reset on restart.
Absolute paths, parent/dot components, hidden destination names, control characters,
and certain special characters are rejected. Existing destinations
are never replaced, including case-only collisions on case-insensitive filesystems.
Save or discard recovery drafts for both names first. IDs, contents, and permissions
stay unchanged. Moves are atomic on supported macOS/Linux filesystems; cross-filesystem
moves fail without copying or deleting the source. If the source changes externally, reload before retrying; a change
detected after the move reports the new location so you can refresh the list.

## Structure

- `src/`: React interface and styles.
- `src/App.tsx`: vault selection and workspace layout.
- `src-tauri/src/note_images.rs`: bounded raster validation, storage and safe preview.
- `src/notes/noteImages.ts`: attachment transfer and editable image widgets.
- `src/notes/equations.ts`: math syntax and bounded, untrusted KaTeX rendering.
- `src/notes/liveMarkdownPreview.ts`: syntax-tree decorations; no stored-text changes.
- `src/notes/MarkdownEditor.tsx`: CodeMirror lifecycle and accepted-edit boundary.
- `src/notes/NoteEditor.tsx`: editing and autosave lifecycle, kept beside the view.
- `src/notes/noteDrafts.ts`: recovery storage shared by the editor and note list.
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

### Local images

Drop or paste one PNG, JPEG, GIF, or WebP file into the editor (up to 8 MiB and
4096 pixels per dimension). The original bytes are saved in a hidden `.attachments`
folder beside the note; Markdown contains a relative reference. Live preview shows
a static image up to 1600 pixels per dimension, including the first frame of animated
images. Click it or switch to Source mode to edit the Markdown. Remote images,
SVG/HTML, reference-style images, and arbitrary existing image paths remain literal.

The editor pauses input during import. Undo removes the Markdown insertion but keeps
the attachment so redo and recovery drafts remain valid. Interrupted imports or
failed saves can leave unused attachments; automatic cleanup is deferred. Renaming
within the same folder preserves images. Moving a note containing `.attachments/`
to another folder is blocked until safe reference updates are implemented. This
conservative check also covers references in code examples. External moves are not
rewritten automatically. Missing images remain editable Markdown.

### Multiple windows

Use **File → New Window** (**Cmd+N** on macOS) or the **New window** button.
Each window has its own vault selection, navigation and editor; new windows start
with the last selected vault. Move windows between macOS desktops using Mission
Control. Closing one window leaves the others open.

A note is editable in one window at a time. Other windows show its saved Markdown
in read-only live preview, refreshing every two seconds and when focused. Different
notes or vaults can be edited simultaneously. Close or navigate away from the owning
editor, then click **Edit here** in another window to continue; retained drafts
remain available. Reopening the app restores the last vault, not the previous window
layout. The folder list refreshes on focus. Existing external-file conflict checks
still apply. Case/Unicode aliases are conservatively treated as the same note.

### Reviewing a PR in a separate checkout

Run commands from the checkout containing the PR branch. A development app already
running from another checkout continues to show that checkout's code.

```sh
# From the PR checkout, with Rust available on PATH:
npm ci
npm run desktop:review
```

This opens **Local Notes — Review** on port 1421, using a separate application
identifier and vault settings. Choose a test vault in this review app. The normal
`desktop:dev` command continues to use port 1420. Both front-end URL and server port
are overridden together; the review windows retain HTML5 image drop support.

Check `git branch --show-current` and `git rev-parse --short HEAD` in the review
checkout to confirm the revision. In the review app, check for the **New window**
button and **File → New Window** before testing image drops or macOS Spaces.

## Review settings

Open the top-right Settings gear to set comma-separated day intervals, a local
alert time, and an IANA timezone (for example `Asia/Hong_Kong`). Initial suggestions
are 3, 7, 30 days, 09:00, and UTC; click **Save review settings** to persist them.
These preferences apply to all vaults/windows of this app installation and are
stored in `review-settings.json` beside `vault.json` in the app configuration folder.

Open settings forms refresh every two seconds and on window focus. Unsaved changes
are preserved when another window saves; **Reload saved settings** explicitly
discards your settings edits and loads the latest values. Stale saves are rejected
by the native backend. Invalid input or failed writes leave the saved file intact.
Damaged settings files are reported and preserved for manual restoration; they are
never silently replaced with defaults. Note content and recovery drafts are separate.

Save review settings **before** saving a new note's content to enable its local
review schedule. First saves before configuration stay unscheduled; settings
changes never reset existing schedules. Creating only the title template does not
start reviews. The hidden ID comment gains a first-save receipt; Markdown body
content remains unchanged. Renaming/moving notes preserves their schedules.

Schedules are stored in `reviews.sqlite` beside settings. See the
[first-save recovery contract](docs/review-scheduling.md#first-save-persistence)
for recovery, backup, and imported-note behavior. Calendar delivery and desktop
notifications are not implemented yet.
