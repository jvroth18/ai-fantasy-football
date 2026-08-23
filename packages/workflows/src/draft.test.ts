import { describe, expect, it } from 'vitest';

import { picksUntilNextSnakeTurn, rankDraftCandidates } from './draft.js';
import {
  automationFixture,
  playerFixture,
  rulesFixture,
  strategyFixture,
} from './test-fixtures.js';

describe('draft assistant', () => {
  it('combines value, need, market urgency, strategy targets, and reach safety', () => {
    const fallen = playerFixture({
      playerId: 'fallen',
      name: 'Fallen Star',
      adp: 8,
      p50: 21,
      p90: 28,
    });
    const reach = playerFixture({
      playerId: 'reach',
      name: 'Deep Sleeper',
      adp: 70,
      p50: 16,
      p90: 27,
    });
    const blocked = playerFixture({ playerId: 'blocked', name: 'Blocked Player', p50: 30, adp: 4 });
    const strategy = strategyFixture({
      blockedPlayerIds: ['blocked'],
      targetPlayerIds: ['fallen'],
    });

    const ranked = rankDraftCandidates([reach, blocked, fallen], {
      overallPick: 24,
      picksUntilNext: 17,
      roster: [],
      rules: rulesFixture(),
      strategy,
      automation: automationFixture(),
    });

    expect(ranked[0]?.player.playerId).toBe('fallen');
    expect(ranked[0]?.reasons).toEqual(
      expect.arrayContaining(['strategy target', 'fell past market ADP']),
    );
    expect(ranked.find((entry) => entry.player.playerId === 'reach')?.autoPickEligible).toBe(false);
    expect(ranked.at(-1)?.player.playerId).toBe('blocked');
  });

  it('calculates the next turn through a snake reversal', () => {
    expect(picksUntilNextSnakeTurn(5, 5, 12)).toBe(15);
    expect(picksUntilNextSnakeTurn(20, 5, 12)).toBe(9);
    expect(() => picksUntilNextSnakeTurn(5, 13, 12)).toThrow('outside the league');
  });
});
