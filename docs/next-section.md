After this editing/autosave PR is merged, implement safe note renaming within the
selected vault. Preserve stable IDs and contents, reject filename collisions and
path escapes, and surface missing or externally changed files. Preserve recovery
drafts or block renaming until the note is saved so drafts cannot become detached.
Keep this review to renaming; defer moves into subfolders, rich Markdown editing,
search, and Google integration. Add meaningful tests, review structure and naming,
consolidate actual duplication, self-review, validate, and open a focused PR with
Summary, How to review, and How to test. Send the Telegram ping and stop for review.
