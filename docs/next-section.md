After this folder-creation and navigation-tree PR is merged, begin section 3 with
a CodeMirror 6 Markdown editor replacing the plain textarea. Add Markdown syntax
highlighting and standard editing behavior while preserving stable IDs, autosave,
recovery drafts, conflict handling, folder navigation, and rename/move protections.
Keep this review to the editing surface; defer rendered preview, LaTeX rendering,
images, search, and Google integration. Add meaningful editor/persistence regression
tests, review structure and naming, consolidate actual duplication, self-review,
validate, and open a focused PR with Summary, How to review, and How to test.
Send the Telegram ping and stop for review.
