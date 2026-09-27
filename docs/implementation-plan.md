# Agreed implementation plan

Build a local-first macOS Note app, keeping a cross-platform Tauri 2 / React /
TypeScript architecture. Markdown files are authoritative; SQLite holds indexes,
review history and sync state. Use CodeMirror 6 and KaTeX, with local attachments.

## Sections

1. Repository foundation and CI.
2. Local vault, notes, stable IDs, safe autosave, rename/move, external edit handling.
3. Markdown editor, equations, drag/drop and paste images, then live preview.
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
`python3 ~/github-telegram-pr/review-bot.py ping NUMBER --project /Users/kyu/notes --next-step-file PATH`,
where PATH contains the next agreed section. Stop at this human checkpoint. If the
bot is unavailable, report that fact; never claim a notification was sent.
