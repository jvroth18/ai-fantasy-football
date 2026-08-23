# ai-fantasy-football

An open-source, local-first fantasy football front office. It combines deterministic scoring and roster logic, free football data, statistical projections, Codex analysis, and auditable ESPN browser automation.

## Status

The project is under active baseline development. The committed `main` branch is kept runnable and tested as each subsystem lands.

## Local development

Requirements:

- Node.js 22 or newer
- pnpm 10.12.4
- Python 3.12 or newer
- [uv](https://docs.astral.sh/uv/)
- Codex CLI for AI and future ESPN Computer Use workflows

```bash
pnpm install
cd services/analytics && uv sync && cd ../..
pnpm codex:check
pnpm dev
```

The web interface runs at `http://127.0.0.1:4317`; the local daemon runs at `http://127.0.0.1:4318`.
Codex authentication stays in the CLI; the readiness check reports only an account type and capability counts. See [docs/CODEX_INTEGRATION.md](docs/CODEX_INTEGRATION.md).

ESPN mutations are disabled by default and developed against a deterministic portal simulator. The live adapter uses visible Computer Use only—never private ESPN endpoints—and every action follows a read, policy check, single attempt, and read-back proof. See [docs/ESPN_AUTOMATION.md](docs/ESPN_AUTOMATION.md).

The football decision layer ranks draft picks, optimizes legal lineups, pairs adds with safe drops and bounded FAAB, escalates player news, and constructs mutually useful market-fair trade ideas. See [docs/DECISION_ENGINES.md](docs/DECISION_ENGINES.md).

The local scheduler runs team-specific refresh and management jobs in each league's configured timezone, prevents overlaps with durable leases, and performs one bounded catch-up after downtime. See [docs/SCHEDULING.md](docs/SCHEDULING.md).

## Verification

```bash
pnpm run ci
```

No paid sports-data subscription is required. See [DATA_SOURCES.md](DATA_SOURCES.md) for source and licensing boundaries.
