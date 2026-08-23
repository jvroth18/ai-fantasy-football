import { describe, expect, it } from 'vitest';

import { playerFixture, strategyFixture } from './test-fixtures.js';
import { generateTradeProposals } from './trades.js';

describe('trade proposal generator', () => {
  it('finds market-fair exchanges that improve both roster fits', () => {
    const ownWr = playerFixture({
      playerId: 'own-wr',
      name: 'Own WR',
      position: 'WR',
      p50: 20,
      replacementValue: 5,
    });
    const otherRb = playerFixture({
      playerId: 'other-rb',
      name: 'Other RB',
      position: 'RB',
      p50: 20,
      replacementValue: 5,
    });

    const proposals = generateTradeProposals(
      { teamId: 'own', players: [ownWr], needs: { WR: 0.6, RB: 1.5 } },
      [{ teamId: 'other', players: [otherRb], needs: { WR: 1.5, RB: 0.6 } }],
      strategyFixture(),
    );

    expect(proposals[0]).toMatchObject({
      opponentTeamId: 'other',
      fairnessRatio: 1,
      send: [{ playerId: 'own-wr' }],
      receive: [{ playerId: 'other-rb' }],
    });
    expect(proposals[0]?.projectedGain).toBeGreaterThan(0);
    expect(proposals[0]?.opponentProjectedGain).toBeGreaterThanOrEqual(0);
  });

  it('never includes a protected outgoing player', () => {
    const protectedPlayer = playerFixture({ playerId: 'protected', position: 'WR', p50: 20 });
    const target = playerFixture({ playerId: 'target', position: 'RB', p50: 20 });
    const proposals = generateTradeProposals(
      { teamId: 'own', players: [protectedPlayer], needs: { WR: 0.6, RB: 1.5 } },
      [{ teamId: 'other', players: [target], needs: { WR: 1.5, RB: 0.6 } }],
      strategyFixture({ protectedPlayerIds: ['protected'] }),
    );

    expect(proposals).toEqual([]);
  });
});
