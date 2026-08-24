# Data sources

The baseline is designed to operate without paid sports-data subscriptions.

- **nflverse**: historical and current NFL datasets. Player statistics from 2023 onward are CC BY-SA 4.0 and must be credited to FTN Data via nflverse; older datasets have their own documented attribution and upstream ownership terms.
- **Sleeper public API**: player metadata and public add/drop trend signals. Its API is documented for non-commercial use and should not be called more frequently than its guidance permits.
- **CollegeFootballData / open college datasets**: optional rookie enrichment. A user-provided free key may be used when available.
- **RSS/Atom and Codex web research**: news metadata, links, citations, and short feed-provided excerpts only; full articles are not republished. The default feed is ESPN's public NFL Headlines RSS feed. Any interface that displays feed content must name the source and link to the original item.
- **ESPN portal**: state visible to the authenticated user through Computer Use. The project does not use private or undocumented ESPN APIs.

Downloaded raw data belongs in `data/raw` or `data/cache`, both of which are ignored by Git.

`pnpm data:seed --season <year>` resolves exact nflverse release assets from the versioned manifest, downloads with atomic replacement, and records byte counts, source update times, and SHA-256 checksums in a local seed lock. A dry run reports the full plan and expected download size without writing files.

The versioned seed manifest keeps NFL player statistics and snap counts from 2012 forward, rosters and depth charts from 2015 forward, injuries from 2009 forward, and complete player/schedule/combine/draft reference tables. This is the reproducible modeling window, not a redistribution of upstream data.
