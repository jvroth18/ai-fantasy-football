import type { PlayerIdentityV1 } from '@ai-ff/domain';
import { describe, expect, it } from 'vitest';

import { compilePlayerReviews } from './player-intelligence.js';

const now = new Date('2026-08-23T12:00:00.000Z');

function player(id: string, fullName: string, gsisId: string): PlayerIdentityV1 {
  return {
    schemaVersion: 1,
    id,
    fullName,
    position: 'RB',
    nflTeam: 'BUF',
    espnId: null,
    sleeperId: id,
    gsisId,
    mappingConfidence: 0.98,
    manuallyVerified: false,
    updatedAt: now.toISOString(),
  };
}

describe('player intelligence compiler', () => {
  it('ranks production independently while retaining transparent buzz and confidence state', () => {
    const alpha = '00000000-0000-4000-8000-000000000001';
    const bravo = '00000000-0000-4000-8000-000000000002';
    const reviews = compilePlayerReviews({
      players: [player(alpha, 'Alpha Runner', '00-a'), player(bravo, 'Bravo Runner', '00-b')],
      stats: [
        {
          gsisId: '00-a',
          season: 2025,
          games: 17,
          fantasyPoints: 280,
          fantasyPointsPpr: 330,
          passingAttempts: 0,
          carries: 260,
          targets: 80,
          receptions: 65,
          touchdowns: 15,
        },
        {
          gsisId: '00-b',
          season: 2025,
          games: 17,
          fantasyPoints: 90,
          fantasyPointsPpr: 120,
          passingAttempts: 0,
          carries: 90,
          targets: 25,
          receptions: 18,
          touchdowns: 3,
        },
      ],
      trends: [
        { playerId: bravo, type: 'add', count: 1_000, lookbackHours: 24 },
        { playerId: alpha, type: 'drop', count: 2, lookbackHours: 24 },
      ],
      news: [],
      now,
    });

    expect(reviews.map((review) => review.fullName)).toEqual(['Alpha Runner', 'Bravo Runner']);
    expect(reviews[0]).toMatchObject({ overallRank: 1, positionRank: 1, trend: 'steady' });
    expect(reviews[1]?.buzz.netAdds24h).toBe(1_000);
    expect(reviews[1]?.momentumScore).toBeGreaterThan(reviews[0]?.momentumScore ?? 0);
    expect(reviews.every((review) => review.sources.length === 2)).toBe(true);
  });

  it('keeps rookies and mapping gaps consultable without inventing history', () => {
    const rookie = player('00000000-0000-4000-8000-000000000003', 'Rookie Runner', '00-c');
    const [review] = compilePlayerReviews({
      players: [rookie],
      stats: [],
      trends: [],
      news: [],
      now,
    });
    expect(review?.seasons).toEqual([]);
    expect(review?.risks.join(' ')).toContain('No matched nflverse season history');
    expect(review?.confidence).toBeLessThan(60);
  });
});
