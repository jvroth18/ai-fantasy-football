import { describe, expect, it } from 'vitest';

import {
  automationFixture,
  playerFixture,
  rulesFixture,
  strategyFixture,
} from './test-fixtures.js';
import { rankWaiverMoves, type DropCandidate, type WaiverCandidate } from './waivers.js';

describe('waiver workflow', () => {
  it('pairs the best add with the least costly legal drop and caps FAAB', () => {
    const protectedDrop: DropCandidate = {
      ...playerFixture({ playerId: 'protected', name: 'Protected', p50: 2 }),
      protected: true,
      locked: false,
      starter: false,
    };
    const legalDrop: DropCandidate = {
      ...playerFixture({ playerId: 'drop', name: 'Drop Me', p50: 7, p90: 9 }),
      protected: false,
      locked: false,
      starter: false,
    };
    const add: WaiverCandidate = {
      ...playerFixture({
        playerId: 'add',
        name: 'Breakout Add',
        p50: 18,
        p90: 30,
        breakoutScore: 0.9,
      }),
      addTrend: 2_000,
      rosteredPercent: 38,
      claimRequired: true,
    };

    const ranked = rankWaiverMoves({
      candidates: [add],
      drops: [protectedDrop, legalDrop],
      strategy: strategyFixture(),
      automation: automationFixture(),
      waivers: rulesFixture().waivers,
      faabRemaining: 35,
      faabSpentThisWeek: 15,
    });

    expect(ranked[0]?.drop?.playerId).toBe('drop');
    expect(ranked[0]?.bid).toBeLessThanOrEqual(15);
    expect(ranked[0]?.projectedPointDelta).toBeGreaterThan(0);
    expect(ranked[0]?.reasons).toContain('breakout profile');
  });

  it('uses immediate free-agent actions without a bid', () => {
    const add: WaiverCandidate = {
      ...playerFixture({ playerId: 'free', p50: 18 }),
      addTrend: 10,
      rosteredPercent: 5,
      claimRequired: false,
    };
    const ranked = rankWaiverMoves({
      candidates: [add],
      drops: [],
      strategy: strategyFixture(),
      automation: automationFixture(),
      waivers: rulesFixture().waivers,
      faabRemaining: 100,
      faabSpentThisWeek: 0,
    });

    expect(ranked[0]).toMatchObject({ actionType: 'free_agent_move', bid: null });
  });
});
