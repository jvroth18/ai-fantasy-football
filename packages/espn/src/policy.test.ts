import { describe, expect, it } from 'vitest';

import { evaluateAutomationPolicy, portalActionFromIntent } from './policy.js';
import { contextFixture, intentFixture, teamFixture } from './test-fixtures.js';

describe('automation policy', () => {
  it('requires an armed, type-enabled policy and fresh data', () => {
    const team = teamFixture({
      automation: { ...teamFixture().automation, armed: false, lineupChanges: false },
    });
    const intent = intentFixture(team.id);
    const action = portalActionFromIntent(intent);
    const decision = evaluateAutomationPolicy(
      contextFixture(team, intent, { dataObservedAt: '2026-08-23T10:00:00.000Z' }),
      action,
    );

    expect(decision.approved).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'Automation is not armed',
        'lineup_change automation is disabled',
        'Data is 480 minutes old',
      ]),
    );
  });

  it('enforces per-claim, weekly, and reserve FAAB limits deterministically', () => {
    const team = teamFixture();
    const intent = intentFixture(team.id, 'waiver_claim', {
      addPlayerId: 'free-wr',
      dropPlayerId: 'starter-rb',
      bid: 30,
    });
    const decision = evaluateAutomationPolicy(
      contextFixture(team, intent, { faabRemaining: 35, faabSpentThisWeek: 20 }),
      portalActionFromIntent(intent),
    );

    expect(decision.approved).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'FAAB bid exceeds the per-claim cap',
        'FAAB bid exceeds the weekly cap',
        'FAAB bid would breach the configured reserve',
      ]),
    );
  });
});
