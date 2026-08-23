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

Browser mutations are not granted by this client. The ESPN adapter creates a separate, reviewable action intent and applies its own safety policy before asking Codex Computer Use to execute anything.

## Protocol compatibility

The typed compatibility surface was validated against Codex CLI `0.149.0`. The app-server protocol is experimental, so upgrades should regenerate the upstream types into a temporary directory, compare the methods used by `@ai-ff/codex`, and run both the unit suite and local readiness probe:

```bash
codex app-server generate-ts --experimental --out /tmp/codex-app-server-types
pnpm run ci
pnpm codex:check
```
