# Fan Desk

Fan Desk is the lightweight media layer for a local fantasy league. It behaves like a tiny sports newsroom watching the same evidence as the manager:

- the latest read-only ESPN Computer Use snapshot and the preceding snapshot;
- the configured RSS/news items, with source URL and publication time;
- the selected team's voice, heat, rumor tolerance, and cadence.

The first pass is deterministic, so the desk still works when Codex is unavailable. When Codex is ready, the daemon supplies a bounded structured-writing turn that can sharpen the headline and copy. The writer is not allowed to invent injuries, trades, or portal state. Every bulletin keeps source evidence and labels its generator.

## Voices

- Superfan: loyal, loud, optimistic pressure.
- Contrarian: deliberately challenges the popular group-chat take.
- Analyst: concise and signal-first.
- Commissioner: official bulletin with controlled heat.

## Cadence and email

The default `fan_digest` job runs every three hours in each team's timezone. It attempts a fresh read-only ESPN observation, falls back to the latest verified snapshot if the portal is unavailable, and publishes a bulletin to the local archive.

Email is opt-in per team from the Fan Desk panel. Configure:

```bash
AI_FF_RESEND_API_KEY=re_...
AI_FF_EMAIL_FROM=fan-desk@example.com
```

Recipients are stored per team. A failed or unconfigured sender is recorded in `fan_email_outbox`; it never changes the post's evidence or causes the scheduler to retry indefinitely.

The desk is commentary, not an execution channel. It cannot submit ESPN actions, accept incoming trades, or bypass sign-in, MFA, or browser warnings.
