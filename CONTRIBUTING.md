# Contributing

Keep each PR focused on one reviewable feature. Use functionality-based file names,
keep related logic together, and extract shared modules when real duplication appears.
Explain non-obvious rationale in comments. Follow existing formatting with `npm run format`.

Before requesting review, inspect the full diff and run the checks in the README.
Add behavior tests for storage, scheduling and synchronization as those features land.
Do not commit credentials, vault content, generated builds or local databases.

Use the PR template: a one-to-two sentence summary, how to review, and how to test.
Include test results and any manual checks that remain. Wait for human review before merge.
