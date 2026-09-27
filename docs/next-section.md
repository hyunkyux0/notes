After this create/list/read PR is merged, implement the next part of section 2:
plain-text note editing with safe autosave and detection of conflicting external
changes. Preserve stable IDs and existing content; surface conflicts instead of
silently overwriting external edits. Keep Markdown authoritative and operations
inside the selected vault. Defer rename/move, rich Markdown editing, search, and
Google integration. Add meaningful persistence/conflict tests, review structure,
consolidate actual duplication, self-review, validate, and open a focused PR with
Summary, How to review, and How to test. Send the Telegram ping and stop for review.
