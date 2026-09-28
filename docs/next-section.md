After this renaming PR is merged, implement safe moves between existing folders
inside the selected vault, including listing and opening moved notes. Preserve
stable IDs and contents, reject collisions and paths/symlinks outside the vault,
and preserve drafts or block moving unsaved notes. Surface missing or externally
changed files. Defer rich Markdown editing, search, and Google integration. Keep
changes reviewable, add meaningful tests, review structure and naming, consolidate
actual duplication, self-review, validate, and open a PR with Summary, How to review,
and How to test. Send the Telegram ping and stop for human review.
