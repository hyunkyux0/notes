# Security

Do not put tokens, personal note content, or sensitive paths in public issues.
Use the repository's private vulnerability reporting feature when available;
otherwise contact the maintainer privately before disclosing sensitive details.

The frontend can load the saved vault or open a native folder picker. Note commands
verify the expected vault against saved settings and accept only direct Markdown
filenames. Directory handles from [cap-std](https://github.com/bytecodealliance/cap-std)
confine note access to the vault, including symlink resolution; links are excluded
from listing and rejected during read validation. New files use exclusive creation
to prevent overwrites. Content is displayed as escaped text, not executable HTML.
There is no Google connection yet. As capabilities are added, grant only the access
needed for the selected vault and explicit features.
