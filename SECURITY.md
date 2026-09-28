# Security

Do not put tokens, personal note content, or sensitive paths in public issues.
Use the repository's private vulnerability reporting feature when available;
otherwise contact the maintainer privately before disclosing sensitive details.

The frontend can load the saved vault or open a native folder picker. Note commands
verify the expected vault against saved settings and validate relative Markdown
paths. Every containing folder is opened with `NOFOLLOW` through its parent handle;
absolute paths, parent traversal, and directory symlinks are rejected. Directory
handles from [cap-std](https://github.com/bytecodealliance/cap-std)
confine note access to the vault, including symlink resolution; links are excluded
from listing and rejected during read validation. New files use exclusive creation
to prevent overwrites. Content is displayed as escaped text, not executable HTML.
Autosave stages a complete file inside the vault, checks the expected contents,
and exchanges files atomically. A displaced version that differs from the expected
contents is retained for recovery. Draft text is also stored unencrypted in the
app's local WebView storage; it is removed when saved or explicitly discarded.
There is no Google connection yet. As capabilities are added, grant only the access
needed for the selected vault and explicit features.

Equation rendering uses KaTeX with `trust: false`, fresh macros per expression,
500 maximum macro expansions, 20em user-specified size limits, and a 4096-character
preview limit. Errors are displayed through textContent, never raw exception HTML.
KaTeX CSS/fonts are bundled locally; the existing content security policy remains
unchanged. Source text is authoritative regardless of rendering success.

Image import accepts only decoded PNG/JPEG/GIF/WebP bytes, limited to 8 MiB,
4096 pixels per dimension and a 64 MiB decoder allocation budget. Import and preview
share validation; preview re-encodes a bounded static PNG. Only managed UUID-named
relative attachments are previewed, with NOFOLLOW directory/file opens and a regular
file check. User-provided remote/data URLs and SVG/HTML never become image sources.
The content security policy is unchanged. HTML5 file transfer is enabled by disabling
Tauri's native drag interception; arbitrary filesystem reading is not exposed.
