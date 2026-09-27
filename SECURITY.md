# Security

Do not put tokens, personal note content, or sensitive paths in public issues.
Use the repository's private vulnerability reporting feature when available;
otherwise contact the maintainer privately before disclosing sensitive details.

The frontend can load the saved vault or open a native folder picker; it cannot
pass arbitrary filesystem paths to these commands. Selection checks folder access
and saves only its path in app configuration, without modifying vault contents.
There is no Google connection yet. As capabilities are added, grant only the access
needed for the selected vault and explicit features.
