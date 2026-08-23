import { describe, expect, it } from 'vitest';

import { optimizeLineup, type LineupPlayer } from './lineup.js';
import { playerFixture, rulesFixture } from './test-fixtures.js';

function lineupPlayer(overrides: Partial<LineupPlayer>): LineupPlayer {
  return {
    ...playerFixture(),
    currentSlot: 'BENCH',
    currentSlotIndex: 0,
    locked: false,
    unavailable: false,
    ...overrides,
  };
}

describe('lineup optimizer', () => {
  it('maximizes the legal risk-adjusted lineup while preserving locks', () => {
    const roster: LineupPlayer[] = [
      lineupPlayer({ playerId: 'qb', name: 'QB', position: 'QB', currentSlot: 'QB', p50: 18 }),
      lineupPlayer({
        playerId: 'rb-low',
        name: 'Locked RB',
        position: 'RB',
        currentSlot: 'RB',
        p50: 8,
        locked: true,
      }),
      lineupPlayer({ playerId: 'rb-high', name: 'Bench RB', position: 'RB', p50: 20 }),
      lineupPlayer({
        playerId: 'wr',
        name: 'WR',
        position: 'WR',
        currentSlot: 'WR',
        p50: 16,
      }),
      lineupPlayer({ playerId: 'te', name: 'TE', position: 'TE', currentSlotIndex: 1, p50: 10 }),
      lineupPlayer({
        playerId: 'wr-out',
        name: 'Unavailable WR',
        position: 'WR',
        p50: 40,
        unavailable: true,
      }),
    ];

    const result = optimizeLineup(rulesFixture(), roster, 0.5);

    expect(result).not.toBeNull();
    expect(result?.assignments).toEqual(
      expect.arrayContaining([
        { playerId: 'rb-low', slot: 'RB', slotIndex: 0 },
        { playerId: 'rb-high', slot: 'FLEX', slotIndex: 0 },
      ]),
    );
    expect(result?.assignments.some((assignment) => assignment.playerId === 'wr-out')).toBe(false);
  });

  it('returns null when a complete legal lineup is impossible', () => {
    const roster = [lineupPlayer({ playerId: 'only-rb', position: 'RB' })];
    expect(optimizeLineup(rulesFixture(), roster, 0.5)).toBeNull();
  });
});
