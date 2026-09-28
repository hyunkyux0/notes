After this first-save persistence PR is merged, begin section 5 with a focused
Google account connection checkpoint. Implement desktop OAuth connection and
disconnection with appropriate state/PKCE and loopback callback protections,
minimal Calendar scopes, and tokens kept in the OS credential store rather than
Markdown, SQLite, or the repository. Provide clear configuration/sign-in/error
states and setup documentation; if a Google OAuth client configuration is missing,
prepare the reviewable implementation and identify the required user setup.
Do not create calendars/events, sync review schedules, or send notifications in
this checkpoint. Preserve all existing note and schedule behavior. Add meaningful
OAuth-flow and credential-lifecycle tests using controlled mocks; distinguish those
from any live sign-in verification. Review structure/naming, consolidate actual
duplication, self-review, validate, and open a focused PR with Summary, How to
review, and How to test. Send the Telegram ping and stop for human review.
