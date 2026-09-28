# Agreed implementation plan

Build a local-first macOS Note app, keeping a cross-platform Tauri 2 / React /
TypeScript architecture. Markdown files are authoritative; SQLite holds indexes,
review history and sync state. Use CodeMirror 6 and KaTeX, with local attachments.

## Sections

1. Repository foundation and CI.
2. Local vault, notes, stable IDs, safe autosave, rename/move, external edit handling,
   folder creation, and an expandable folder/file tree for navigation. Show empty
   folders, open notes from the tree, and create notes in the selected folder.
   Use readable title-based filenames with numeric collision suffixes; keep stable
   IDs inside Markdown. Deliver this filename improvement before image attachments.
3. Workspace layout and Obsidian-style live Markdown editing, delivered through
   the separate review checkpoints below. Live preview is the default editing
   experience; a Source mode toggle exposes raw Markdown.
4. Review scheduler: 3, 7, 30 calendar days after first nonempty save; configurable
   intervals, alert time and timezone. Ordinary edits do not reset the schedule.
5. Google OAuth and a dedicated Note Reviews calendar: 15-minute events, note path
   in Location, app link in description, review number in title.
6. Offline queue, duplicate prevention, moved-note updates, respect remote deletions,
   explicit rescheduling of pending reviews when configuration changes.
7. One notification source: Google Calendar or native desktop alerts. Disable the
   other source and reconcile existing event reminders when switching.
8. Settings, search, review completion, rescheduling and sync recovery UI.
9. Full workflow verification.
10. MIT license, contribution/security documentation, screenshots and macOS release.

## Next layout and editor checkpoints

Complete these in order, with a focused PR and human review before advancing:

1. **Workspace layout:** place the expandable folder/file tree in the left sidebar.
   Put the vault name and open/switch control at the top left, replacing Local Notes;
   show Open vault when none is selected. Move Settings to a small top-right gear
   with an accessible label and tooltip. Make the sidebar resizable and collapsible,
   with New note and New folder controls above the tree. A folder's chevron toggles
   expansion; its name selects the destination for creation. Give the editor the
   main area, with the note path and save/conflict status nearby. Reserve a compact
   sidebar-bottom Reviews entry for scheduling. Preserve drafts during navigation.
2. **CodeMirror foundation:** replace the textarea with CodeMirror 6, retaining
   ordinary Markdown files, stable IDs, autosave, recovery drafts, conflict handling,
   and rename/move protections. Add syntax highlighting and standard editing behavior.
   This is the foundation checkpoint, not the completed live-preview experience.
3. **Live Markdown formatting:** make inline live preview the default. Format
   headings, emphasis, lists, links, and code while editing; reveal Markdown syntax
   around the active editing region. Provide a Source mode toggle without converting
   or rewriting the underlying Markdown. Preserve selection, undo/redo, and drafts
   when switching modes. A separate preview pane is not the primary editing flow.
4. **Equations:** render inline and display LaTeX with KaTeX in the editor; expose
   the source when editing an equation. Handle invalid expressions without losing text.
5. **Images:** show local images inline and support drag-and-drop and paste into
   the editor, saving attachments inside the vault and inserting Markdown references.
   Preserve existing attachments and apply vault path protections.
6. **Multiple windows (before scheduling):** File → New Window / Cmd+N creates an
   independent workspace that can be placed on another macOS desktop. Each window
   selects its own vault and note. One window edits a given note at a time; others
   can read its saved contents. Preserve shared recovery drafts, protect rename
   destinations, release editing ownership on navigation/close, and keep other
   windows open when one closes. Existing file conflict checks still apply.

Use meaningful persistence, navigation, and editing regression tests at each stage.
This follows Obsidian's Markdown-based model rather than introducing a Notion-style
block-storage format. Search, scheduling, and Google integration follow these stages.
The updated layout checkpoint supersedes the earlier Telegram instruction to start
CodeMirror immediately after the folder-tree PR.

## Scheduling checkpoints

1. Pure date calculation with explicit timezone, validated settings, and tested
   daylight-saving policies (see [scheduling contract](review-scheduling.md)).
2. Review settings UI and persistence, including consistency across windows.
3. Persist schedules once on the first nonempty save; ordinary edits keep them.
   Calendar delivery and notifications follow the later sections above.

## Review contract

For each section: implement, review directory structure, consolidate actual
duplication into functionality-named modules, self-review, fix findings, validate,
then push a small feature branch and open a PR. Aim for 200–400 handwritten lines
per review where feasible; split larger sections coherently. Explain non-obvious
rationale. Never sacrifice readability just to reduce line count.

PR description: **1. Summary** (one or two sentences with key changes),
**2. How to review** (files/order/focus), **3. How to test** (commands, manual steps,
expected outcomes and checks already run). Human review occurs before merging.
Do not merge automatically. Address feedback or advance only after verifying merge.
Use the personal `github-telegram-pr` skill at
`~/agent-skills/github-telegram-pr/SKILL.md`. The shared bot is maintained outside
this project at `~/github-telegram-pr`; setup instructions are in its README.
Send a Telegram review ping after each reviewable section using
`python3 ~/github-telegram-pr/review-bot.py ping NUMBER --project "$PWD" --next-step-file PATH`,
where PATH contains the next agreed section. Stop at this human checkpoint. If the
bot is unavailable, report that fact; never claim a notification was sent.
