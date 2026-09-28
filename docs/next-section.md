After this workspace-layout PR is merged, implement only the CodeMirror foundation
checkpoint in section 3. Replace the plain textarea with a CodeMirror 6 Markdown
editor with syntax highlighting and standard editing behavior. Preserve stable IDs,
Markdown files, autosave, recovery drafts, conflict handling, folder navigation,
and rename/move protections. Keep this PR to the editor foundation; default inline
live preview and the Source mode toggle follow in the next separate checkpoint,
then KaTeX equations and local images. Defer search and Google integration. Add
meaningful editor/persistence regression tests, review structure and naming,
consolidate actual duplication, self-review, validate, and open a focused PR with
Summary, How to review, and How to test. Send the Telegram ping and stop for review.
