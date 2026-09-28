# Review scheduling core

`src-tauri/src/review_schedule.rs` calculates review dates without accessing the
editor, disk, clock, network, or notification service. Its tests live beside it in
`review_schedule/tests.rs`; the library entry point allows independent testing.

Call `ReviewSettings::new(intervals, alert_time, timezone)`, then
`calculate_reviews(first_saved_at, &settings)`. `DEFAULT_INTERVALS` is `[3, 7, 30]`.
Intervals must be nonempty, positive, unique, and strictly increasing. The alert
time must be `HH:MM` (00:00–23:59); the timezone must be a name recognized by the
bundled IANA database, such as `Asia/Hong_Kong`. There is no implicit machine
timezone or default alert time. Invalid settings or unrepresentable dates return
an error, never a partial schedule.

Each offset is counted from the **local date of the original first nonempty save**,
not from the previous review or the current time. A 09:00 alert remains at 09:00
across daylight-saving changes unless that time does not exist. The output retains
the interval, named timezone, and resolved instant/UTC offset.

Clock-change policy:

- Missing local time: use the first valid instant after the gap. For example,
  New York's 02:30 on March 8, 2026 becomes 03:00, not 03:30. This applies to
  half-hour changes and skipped dates too. Later intervals use their original
  requested time independently.
- Repeated local time: use the earlier instant, producing one review per interval.
- Distinct intervals remain distinct even if a historical skipped date makes them
  resolve to the same instant; future notification delivery can group coincident
  reminders without deleting logical reviews.

The implementation uses Chrono's checked calendar-date arithmetic and
[chrono-tz's gap information](https://docs.rs/chrono-tz/0.10.4/chrono_tz/struct.GapInfo.html),
not a fixed number of seconds per day. Timezone rules are bundled with the locked
Rust dependencies; future rule updates require a dependency update.

Run `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked` for just the
scheduling core. The existing full Rust test command also includes these tests.

## First-save persistence

The desktop save command now records first saves in `reviews.sqlite` beside app
settings. Records are keyed by canonical vault path and stable note ID, not filename.
Renames/moves inside the vault therefore preserve the original anchor and dates.
`confirmed = 1` records are eligible for later delivery; pending records must never
be delivered. `reviews` contains the immutable calculated dates/intervals/timezone;
SQL NULL means the first save occurred before settings were configured.

Only a successful non-whitespace content save starts the process. The generated
title template at creation does not count. The anchor is the timestamp of the
successful save operation, captured after waiting for the scheduling lock. Each
attempt's intent is persisted before the Markdown write. The existing hidden ID
comment gains a `; first-save: UUID` receipt in the same atomic replacement as the
body. SQLite confirms only that exact receipt. No receipt means an interrupted or
rejected attempt is discarded on retry with a fresh anchor. A matching receipt
confirms the original intent on reopening, even if the body has since changed.
This avoids guessing whether an interrupted write completed from a body hash or
file modification date. The Markdown body is unchanged by scheduling metadata.

Existing confirmed records are never recalculated during ordinary edits, settings
changes, or window switches. Edits made before settings are explicitly saved stay
unscheduled; configuring settings later does not enroll or backdate those notes.
For older app-created notes without a record, the next successful nonempty save
is their first observed save, with a current anchor, never an inferred creation date.
External Markdown without an app note ID stays editable but is not auto-enrolled.

Storage failures before the Markdown replacement leave it untouched. A failure
confirming an already replaced file returns a save error, retaining the recovery
draft for idempotent retry. Review-storage failures do not hide readable Markdown.
If a note carries a receipt but its database record is missing (for example after
copying a note from another installation), it remains editable and shows a warning;
no new dates are silently invented. Restore the matching database backup to recover
the schedule. Back up both Markdown and `reviews.sqlite` for review-history recovery.
Recovery runs when a note is opened or saved; there is no background delivery yet.

Calendar calls, notifications, review completion, and rescheduling UI remain deferred.
