After this CodeMirror foundation PR is merged, implement the live Markdown formatting
checkpoint in section 3. Make inline live preview the default: format headings,
emphasis, lists, links, and code while revealing Markdown syntax around the active
editing region. Provide a Source mode toggle without rewriting the Markdown or
losing selection, undo/redo, or recovery drafts. Preserve autosave, conflicts,
stable IDs, folder navigation, and rename/move protections. Keep note HTML inert
and preserve the content security policy. Defer equations, images, search, and
Google integration. Keep changes reviewable, add meaningful editing/persistence
regression tests, review structure and naming, consolidate actual duplication,
self-review, validate, and open a focused PR with Summary, How to review, and How
to test. Send the Telegram ping and stop for human review.
