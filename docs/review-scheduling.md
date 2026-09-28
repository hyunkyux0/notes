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

This checkpoint does not create schedules in the running app. Later persistence
integration must record the first nonempty save and the resulting schedule once,
then reuse them on ordinary edits. Settings changes must not silently reschedule
existing reviews. The Settings UI now persists preferences using this validation. Note schedule
persistence, Google Calendar, and notifications remain separate checkpoints.
