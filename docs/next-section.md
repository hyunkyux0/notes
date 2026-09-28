After this readable-filename PR is merged, begin the images checkpoint with safe local
image attachments and inline image preview. Support drag-and-drop and paste of
local raster images, storing attachments inside the selected vault with collision-
safe filenames and Markdown references relative to the note. Preserve existing
files, reject path escapes and symlink escapes, and keep remote URLs and SVG/HTML
inert. Preserve Markdown authority, undo/redo, drafts, autosave, conflicts, and
stable IDs; ensure attachment references remain valid when renaming/moving notes
or explicitly block operations that cannot preserve them safely. Keep the change
reviewable, add meaningful storage and UI tests, review structure and naming,
consolidate actual duplication, self-review, validate, and open a focused PR with
Summary, How to review, and How to test. Defer search, scheduling, and Google
integration. Send the Telegram ping and stop for human review.
