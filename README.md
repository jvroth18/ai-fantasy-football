# ai-fantasy-football

An open-source, local-first fantasy football front office. It combines deterministic scoring and roster logic, free football data, statistical projections, Codex analysis, and auditable ESPN browser automation.

## Status

The first local-first baseline is functional and remains under active development. The committed `main` branch is kept runnable and tested with incremental commits as each subsystem lands.

## Local development

Requirements:

- Node.js 22 or newer
- pnpm 10.12.4
- Python 3.12 or newer
- [uv](https://docs.astral.sh/uv/)
- Codex CLI for player valuation, rule extraction, and ESPN Computer Use workflows

```bash
pnpm install
cd services/analytics && uv sync && cd ../..
pnpm codex:check
pnpm dev
```

Preview or materialize the reproducible free-data seed separately:

```bash
pnpm data:seed --season 2026 --dry-run
pnpm data:seed --season 2026
```

The second command downloads the available nflverse Parquet window into ignored local cache storage. It uses exact asset-name patterns, atomic file replacement, SHA-256 verification, and `data/cache/nflverse/seed-lock.json` for resumable reuse. Current-season datasets that nflverse has not published yet are recorded as optional missing assets instead of being silently invented.

The web interface runs at `http://127.0.0.1:4317`; the local daemon runs at `http://127.0.0.1:4318`.
Codex authentication stays in the CLI; the readiness check reports only an account type and capability counts. See [docs/CODEX_INTEGRATION.md](docs/CODEX_INTEGRATION.md).

The responsive front office guides first-run team creation, keeps every team independently switchable, and exposes rules, strategy, roster, player intelligence, draft, waiver, trade, schedule, audit, and safety workspaces. The interface has no external font or analytics dependency.

ESPN mutations are disabled by default and developed against a deterministic portal simulator. The live adapter uses visible Computer Use only—never private ESPN endpoints—and every action follows a read, policy check, explicit UI confirmation, single attempt, and read-back proof. Incoming trade acceptance is always manual. See [docs/ESPN_AUTOMATION.md](docs/ESPN_AUTOMATION.md).

The football decision layer ranks draft picks, optimizes legal lineups, pairs adds with safe drops and bounded FAAB, escalates player news, and constructs mutually useful market-fair trade ideas. See [docs/DECISION_ENGINES.md](docs/DECISION_ENGINES.md).

The local scheduler runs team-specific refresh and management jobs in each league's configured timezone, prevents overlaps with durable leases, and performs one bounded catch-up after downtime. See [docs/SCHEDULING.md](docs/SCHEDULING.md).

Team onboarding, rule upload/review, strategy configuration, automation arming, manual management runs, and approved recommendation execution are exposed through the loopback-only daemon API. Uploaded binary rule files are held only long enough for a read-only Codex extraction turn and then removed. See [docs/LOCAL_DAEMON.md](docs/LOCAL_DAEMON.md).

The player-intelligence directory compiles three-season performance, opportunity, roster-market momentum, and attributed news attention into transparent independent rankings. Reviews are searchable in the web app and exportable as a versioned JSON/JSONL handoff for another AI agent. See [docs/PLAYER_INTELLIGENCE.md](docs/PLAYER_INTELLIGENCE.md).

## First team workflow

1. Start ESPN Fantasy Football in an already authenticated visible browser session, then run `pnpm dev`.
2. Create a team with the ESPN league and team IDs shown in the portal.
3. Upload league rules, review the extracted revision, and activate it.
4. Configure a strategy, refresh public data, and run the read-only ESPN sync.
5. Run the daily manager or a focused draft, waiver, lineup, or trade job.
6. Keep recommendations advisory, or separately arm exact action classes in Automation. An actionable recommendation still requires a final confirmation before Computer Use can submit it.

## Verification

```bash
pnpm run ci
```

No paid sports-data subscription is required. See [DATA_SOURCES.md](DATA_SOURCES.md) for source and licensing boundaries.
