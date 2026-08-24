---
name: fantasy-player-intelligence
description: Compile, inspect, explain, and export source-backed fantasy-football player reviews and rankings in the ai-fantasy-football workspace. Use for player comparisons, ranking audits, data refreshes, buzz interpretation, or handoff bundles for another AI agent.
---

# Fantasy Player Intelligence

Use the repository's deterministic player-intelligence compiler as the source of ranking state. Do
not substitute an improvised web ranking or treat market attention as player quality.

## Choose the operation

- **Consult:** Query `GET /api/players` for a ranked list or `GET /api/players/:playerId` for one
  complete dossier. Use `position`, `search`, `limit`, and `offset` filters when useful.
- **Refresh:** Trigger the configured `data_refresh` job for a team when identities, stats, or
  Sleeper movement are absent or stale. Trigger `news_refresh` when attributed news state is stale.
  Keep the originating task active until the job returns and inspect its final status.
- **Handoff:** Prefer
  `GET /api/player-intelligence/export?format=jsonl` for another agent. The manifest is the first
  record and each remaining record is one independent player dossier. Use `format=json` only when
  the consumer needs one object.
- **Audit or change methodology:** Read `docs/PLAYER_INTELLIGENCE.md`,
  `packages/data/src/player-intelligence.ts`, and the related tests before changing weights or
  claims. Run `pnpm run ci` after changes.

## Interpretation invariants

- Historical production uses the three latest completed regular seasons with 62/25/13 recency
  weights. Production and opportunity are compared within position and only against peers with
  actual evidence.
- The independent score weights historical production 55%, opportunity 20%, Sleeper add/drop
  momentum 15%, and attributed news attention 10%.
- Sleeper momentum measures roster-market behavior. News buzz measures attributed mentions. They
  are separate context signals and neither proves talent, role, health, or future performance.
- Keep rookies and mapping gaps consultable. Report missing history and reduced confidence; never
  invent statistics or silently drop them.
- Ambiguous ESPN or GSIS mappings remain null with reduced confidence. Do not guess ownership of a
  duplicate upstream identifier.
- Overall ranks are cross-position evidence scores, not league-specific draft ranks. For a real
  draft decision, apply the active league's scoring, roster construction, replacement value, ADP,
  and positional scarcity after consulting the dossier.
- Preserve each dossier's source URLs and observation times in explanations and handoffs. State the
  bundle generation time and note staleness when it matters.

## Handoff contract

A downstream agent should receive the complete JSONL file or a bounded subset of player records
plus the manifest. Tell it to preserve component scores, confidence, missing-data warnings, source
timestamps, and the distinction between independent rank and consensus/ADP. If consensus or expert
rankings are added later, keep them as attributed comparison inputs rather than overwriting the
independent score.
