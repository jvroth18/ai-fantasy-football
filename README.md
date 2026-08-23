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

## Verification

```bash
pnpm run ci
```

No paid sports-data subscription is required. See [DATA_SOURCES.md](DATA_SOURCES.md) for source and licensing boundaries.
