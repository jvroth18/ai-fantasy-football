import { describe, expect, it } from 'vitest';

import { findLegalStarterAssignments, validateLineup, type RosterPlayer } from './roster.js';
import { pprRulesFixture } from './test-fixtures.js';

const roster: RosterPlayer[] = [
  { playerId: 'qb-1', position: 'QB' },
  { playerId: 'rb-1', position: 'RB' },
  { playerId: 'rb-2', position: 'RB' },
  { playerId: 'rb-3', position: 'RB' },
  { playerId: 'wr-1', position: 'WR' },
  { playerId: 'wr-2', position: 'WR' },
  { playerId: 'te-1', position: 'TE' },
];

describe('roster legality', () => {
  it('finds a complete legal assignment including the flex slot', () => {
    const rules = pprRulesFixture();
    const assignments = findLegalStarterAssignments(rules, roster);

    expect(assignments).not.toBeNull();
    expect(assignments).toHaveLength(7);
    expect(validateLineup(rules, roster, assignments ?? []).valid).toBe(true);
  });

  it('rejects an ineligible and duplicated player', () => {
    const rules = pprRulesFixture();
    const validation = validateLineup(rules, roster, [
      { playerId: 'rb-1', slot: 'QB', slotIndex: 0 },
      { playerId: 'rb-1', slot: 'RB', slotIndex: 0 },
    ]);

    expect(validation.valid).toBe(false);
    expect(validation.violations.map((violation) => violation.code)).toEqual([
      'ineligible_position',
      'duplicate_player',
    ]);
  });
});
