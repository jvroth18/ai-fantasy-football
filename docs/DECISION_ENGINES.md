# Decision engines

`@ai-ff/workflows` owns the deterministic core of every recommendation. A bounded Codex turn estimates scoring-specific percentiles, replacement baselines, ADP, tiers, injury risk, breakout/bust risk, and identity confidence for an exact portal-derived player list. The application rejects incomplete or extra IDs, applies transparent news multipliers, and then runs deterministic engines. Codex cannot change roster legality, automation policy, FAAB caps, trade fairness, or idempotency rules.

## Draft

Candidates combine risk-adjusted projections, value over replacement, starter demand, positional weights, tier scarcity, ADP value, estimated survival to the next pick, stack preferences, explicit targets, mapping confidence, and maximum reach. Blocked players are never auto-pick eligible.

## Weekly lineup

The optimizer searches complete legal assignments and maximizes the configured floor/upside objective. It respects eligible positions, flexible slots, unavailable players, and already locked ESPN slots. It returns the selected p10/p50/p90 totals and only the changes required from the current lineup.

## Waivers and free agents

The engine evaluates each add against the least costly legal drop, excluding protected or locked players. Breakout signals and market add velocity affect rank. Suggested FAAB is bounded by the rule-set minimum, per-claim and weekly policy caps, remaining budget, and reserve. Free agents produce immediate-move recommendations without bids.

## News

RSS metadata and short excerpts are linked to canonical players, then classified into injury, opportunity, suspension, transaction, or general alerts. Concrete absence language is escalated; vague mentions remain low urgency. Source links and timestamps stay attached.

## Trades

The proposal generator searches one- and two-player packages, excludes protected outgoing and blocked incoming players, requires market value within a configured fair band, and requires positive roster-fit gain for the user without projecting harm to the opponent. These are outgoing proposals only; incoming acceptance remains manual.

All formula outputs include component reasons and uncertainty. They should be backtested and calibrated during the season instead of being treated as truth.

Successful jobs atomically expire prior advice of the same type and persist the replacement set with the verified ESPN digest, active rule evidence, and consulted public source URLs. If ESPN, Codex, rules, strategy, or public player data is unavailable, the job returns `needs_attention` and preserves the last valid advice.
