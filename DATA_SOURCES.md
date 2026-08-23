# Data sources

The baseline is designed to operate without paid sports-data subscriptions.

- **nflverse**: historical and current NFL datasets. Dataset-specific attribution and upstream ownership terms apply.
- **Sleeper public API**: player metadata and public add/drop trend signals. Its API is documented for non-commercial use and should not be called more frequently than its guidance permits.
- **CollegeFootballData / open college datasets**: optional rookie enrichment. A user-provided free key may be used when available.
- **RSS/Atom and Codex web research**: news metadata, links, citations, and short excerpts only; full articles are not republished.
- **ESPN portal**: state visible to the authenticated user through Computer Use. The project does not use private or undocumented ESPN APIs.

Downloaded raw data belongs in `data/raw` or `data/cache`, both of which are ignored by Git.

The versioned seed manifest keeps NFL player statistics and snap counts from 2012 forward, rosters and depth charts from 2015 forward, injuries from 2009 forward, and complete player/schedule/combine/draft reference tables. This is the reproducible modeling window, not a redistribution of upstream data.
