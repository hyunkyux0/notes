After this review-settings PR is merged, implement the first-save schedule
persistence checkpoint. Persist the first successful nonempty-save anchor and its
calculated reviews once per stable note ID, using validated saved review settings.
Ordinary edits and window changes must not reset or duplicate a schedule. Keep
Markdown authoritative and handle failed writes, conflicts, app restarts, and
concurrent windows without losing note content or recovery drafts. Define behavior
for notes saved before settings are configured; do not silently backdate schedules.
Preserve schedules across supported rename/move operations. Keep this checkpoint
to local persistence; defer calendar API calls, notifications, review completion,
and rescheduling UI. Add meaningful persistence and concurrency tests, review
structure/naming, consolidate actual duplication, self-review, validate, and open
a focused PR with Summary, How to review, and How to test. Send the Telegram ping
and stop for human review.
