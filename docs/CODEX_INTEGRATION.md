# Codex integration

The local daemon starts `codex app-server --stdio` and communicates with newline-delimited JSON-RPC. It performs the required `initialize`/`initialized` handshake, then uses the supported account, model, skill, thread, and turn methods.

## Authentication boundary

Codex CLI owns login and token refresh. This project calls `account/read`; it does not read `auth.json`, copy tokens, or persist email addresses. Run `codex login` outside the application if the readiness check reports that authentication is required.

```bash
pnpm codex:check
```

The check is read-only. It reports whether decisions and ESPN Computer Use are ready, plus model and skill counts.

## Decision contract

- Decision threads default to `sandbox: read-only` and `approvalPolicy: never`.
- Recommendations use `turn/start` with a JSON output schema and an application-owned runtime validator.
- Unexpected server requests fail closed.
- Every request and completed turn is correlated by its exact JSON-RPC, thread, and turn identifiers.
- A caller can interrupt a specific in-flight turn.

Player valuation turns receive an exact bounded player-ID set, the active scoring rules, strategy, current attributed news, and an explicit weekly, rest-of-season, or draft horizon. Their output is rejected if Codex omits, duplicates, or invents an ID. Deterministic application code—not Codex—then applies roster legality, positional demand, FAAB limits, trade fairness, and automation policy.

Browser mutations are not granted by ordinary decision threads. The ESPN action service creates a separate ephemeral Computer Use thread only after a typed action intent, armed per-action policy, current snapshot, and explicit execution confirmation exist.

## Protocol compatibility

The typed compatibility surface was validated against Codex CLI `0.149.0`. The app-server protocol is experimental, so upgrades should regenerate the upstream types into a temporary directory, compare the methods used by `@ai-ff/codex`, and run both the unit suite and local readiness probe:

```bash
codex app-server generate-ts --experimental --out /tmp/codex-app-server-types
pnpm run ci
pnpm codex:check
```
