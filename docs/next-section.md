After this Google connection PR is merged, implement the dedicated Note Reviews
calendar checkpoint in section 5. Add an explicit setup action that creates or
reuses the app's dedicated calendar with the existing minimal scope. Refresh
credentials through the OS store, handle revoked grants clearly, and persist the
calendar association safely across restarts, disconnect/reconnect, and concurrent
windows without reusing another account's association. Handle ambiguous network
outcomes without blindly duplicating calendars. Keep this checkpoint to calendar
setup; defer event creation, schedule sync, notifications, and review completion.
Preserve notes, drafts, and local schedules. Add controlled API/credential tests,
distinguish them from live verification, review structure and naming, consolidate
actual duplication, self-review, validate, and open a focused PR with Summary,
How to review, and How to test. Send the Telegram ping and stop for human review.
