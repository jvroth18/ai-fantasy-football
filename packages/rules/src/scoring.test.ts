import { describe, expect, it } from 'vitest';

import { scoreStatLine } from './scoring.js';
import { pprRulesFixture } from './test-fixtures.js';

describe('deterministic scoring engine', () => {
  it('applies fractional scoring, negative events, and threshold bonuses', () => {
    const rules = pprRulesFixture();
    const result = scoreStatLine(rules.scoring, {
      passing_yards: 300,
      passing_touchdowns: 2,
      interceptions: 1,
      rushing_yards: 27,
      receptions: 6,
      receiving_yards: 54,
      unsupported_stat: 12,
    });

    expect(result.total).toBe(35.1);
    expect(result.breakdown.find((item) => item.stat === 'passing_yards')).toMatchObject({
      basePoints: 12,
      bonusPoints: 3,
      totalPoints: 15,
    });
    expect(result.unscoredStats).toEqual(['unsupported_stat']);
  });

  it('does not round intermediate fractional scoring to whole points', () => {
    const rules = pprRulesFixture();
    const result = scoreStatLine(rules.scoring, { receiving_yards: 87 });

    expect(result.total).toBe(8.7);
  });
});
