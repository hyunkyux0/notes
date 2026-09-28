After this scheduling-core PR is merged, implement a focused review-settings
checkpoint: configure and persist review intervals (default 3, 7, 30), local alert
time, and an explicit IANA timezone through Settings. Reuse the scheduling core's
validation; make invalid settings recoverable and preserve the last valid values.
Keep settings consistent across windows without disrupting notes or drafts.
Do not create or reset note schedules yet: first-save schedule persistence follows
in a separate checkpoint. Defer calendar calls and notifications. Add meaningful
settings persistence and UI tests, review structure and naming, consolidate actual
duplication, self-review, validate, and open a focused PR with Summary, How to
review, and How to test. Send the Telegram ping and stop for human review.
