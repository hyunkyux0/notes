After this live Markdown preview PR is merged, implement only the equations
checkpoint in section 3: inline and display LaTeX with KaTeX in live preview.
Reveal the original LaTeX source when editing an equation and in Source mode.
Handle invalid expressions without losing text. Preserve Markdown authority,
selection, undo/redo, autosave, conflicts, recovery drafts, stable IDs, and folder
navigation. Keep rendering untrusted expressions safe and preserve the content
security policy. Defer images, search, scheduling, and Google integration. Add
meaningful equation/editing/persistence tests, review structure and naming,
consolidate actual duplication, self-review, validate, and open a focused PR with
Summary, How to review, and How to test. Send the Telegram ping and stop for review.
