# Player intelligence and AI handoff

The player-intelligence compiler creates an independent, reproducible review for every active
fantasy-relevant player in the Sleeper catalog. It is not a copy of an expert ranking.

## Inputs

- nflverse regular-season player statistics for the three latest completed seasons
- Sleeper active-player identity mappings and 24-hour add/drop velocity
- configured RSS/Atom headlines and summaries, matched to canonical player identities

Historical per-game PPR production supplies 55% of the score, recent opportunity 20%, Sleeper
roster momentum 15%, and attributed news attention 10%. Each component is position-relative so a
quarterback's raw scoring does not automatically outrank every other position. Buzz measures
attention rather than talent and is intentionally a minority input.

Players without matched history remain in the directory with explicit low-confidence warnings.
This covers rookies and mapping gaps without inventing statistics.

## Refresh

Run the daemon's `data_refresh` job to update identities, trends, historical performance, and
rankings. `news_refresh` updates attributed news counts and recompiles the reviews.

## Handoff to another AI agent

Download the versioned JSON Lines bundle from the web interface or run:

```bash
curl -fsSL 'http://127.0.0.1:4318/api/player-intelligence/export?format=jsonl' \
  -o player-intelligence.jsonl
```

The first line is a manifest containing schema version, generation time, player count, weights,
and caveats. Every remaining line is one complete player dossier: identity, overall and position
rank, component scores, confidence, three-season stats, Sleeper market state, news-mention count,
strengths, risks, review text, and attributed source timestamps. JSON Lines allows another agent to
stream or retrieve individual players without loading the entire universe into context.

For tools that prefer one JSON object, use `format=json`. Searchable consultation endpoints are:

- `GET /api/players?position=WR&search=smith&limit=100&offset=0`
- `GET /api/players/:playerId`
- `GET /api/player-intelligence/export?format=jsonl`
