# ESPN automation safety model

ESPN has no supported public API for this application, so the live adapter uses Codex Computer Use against the user's existing browser session. It must not call undocumented ESPN endpoints, capture credentials, bypass login or MFA, or retry an uncertain submission.

## Execution state machine

1. Create a typed action intent with a team-scoped idempotency key.
2. Apply deterministic policy checks: the team must be armed, that action class must be enabled, source data must be fresh, and FAAB limits must hold.
3. Observe the portal and visibly match the configured league and team.
4. Validate the action against observed roster, availability, lock, waiver, or draft state.
5. Submit the exact action at most once.
6. Observe again and verify the intended state.
7. Mark the action `verified`, `failed`, or `needs_attention` with before/after digests and short evidence.

If a browser response is ambiguous, the read-back determines success. If read-back cannot prove success, the action stops at `needs_attention`; a scheduler cannot blindly retry it. Incoming trade acceptance is not represented by the action schema and remains permanently manual.

## Simulator-first development

`SimulatedEspnPortal` implements the same adapter contract as Computer Use. It models lineup swaps, waiver claims, free-agent moves, draft picks, and outgoing trade proposals, including ambiguous outcomes. All CI and end-to-end development runs against this simulator. Live ESPN actions require a separately armed team policy and an existing signed-in session.

```bash
pnpm --filter @ai-ff/espn test
```

Do not commit screenshots, accessibility captures, cookies, tokens, or downloaded account data. Evidence retained by the application is intentionally short, structural, and local.
