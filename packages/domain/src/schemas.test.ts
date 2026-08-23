import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  leagueRuleSetV1Schema,
  projectionV1Schema,
  teamConfigV1Schema,
  type LeagueRuleSetV1,
  type TeamConfigV1,
} from './schemas.js';

const now = '2026-08-23T12:00:00.000Z';

function teamFixture(): TeamConfigV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    name: 'Fourth and Goal',
    platform: 'espn',
    season: 2026,
    timeZone: 'America/New_York',
    color: '#b9f55b',
    espnLeagueId: '12345',
    espnTeamId: '7',
    activeRuleSetId: null,
    strategyProfileId: null,
    automation: {
      armed: false,
      lineupChanges: false,
      waiverClaims: false,
      freeAgentMoves: false,
      draftPicks: false,
      outgoingTradeOffers: false,
      incomingTradeAccepts: false,
      maxFaabPerClaim: null,
      maxFaabPerWeek: null,
      minimumFaabReserve: 0,
      maximumDraftReach: 24,
      minimumDataFreshnessMinutes: 180,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function rulesFixture(teamId: string): LeagueRuleSetV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    name: '2026 PPR',
    season: 2026,
    platform: 'espn',
    status: 'draft',
    revision: 1,
    scoring: [
      {
        stat: 'passing_yards',
        label: 'Passing yards',
        pointsPerUnit: 1,
        unitSize: 25,
        bonuses: [],
        evidence: [],
      },
    ],
    roster: [
      { slot: 'QB', count: 1, starter: true, eligiblePositions: ['QB'] },
      { slot: 'BENCH', count: 6, starter: false, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] },
    ],
    draft: { type: 'snake', teamCount: 12, rounds: 16, secondsPerPick: 90, auctionBudget: null },
    waivers: {
      type: 'faab',
      budget: 100,
      minimumBid: 0,
      processingDays: [3],
      processingTimeLocal: '03:00',
      freeAgentMode: 'first_come',
      maxAcquisitionsPerWeek: null,
      tiebreaker: 'rolling_order',
    },
    lineup: { lockType: 'player_game_time', allowBenchEditsAfterLock: true },
    playoffs: {
      teams: 6,
      startWeek: 15,
      championshipWeek: 17,
      twoWeekMatchups: false,
      reseed: false,
    },
    trades: {
      deadlineWeek: 12,
      reviewType: 'league_vote',
      reviewHours: 24,
      futureDraftPicksAllowed: false,
    },
    evidence: [],
    createdAt: now,
  };
}

describe('versioned domain schemas', () => {
  it('accepts an independently configured ESPN team and ruleset', () => {
    const team = teamConfigV1Schema.parse(teamFixture());
    const rules = leagueRuleSetV1Schema.parse(rulesFixture(team.id));

    expect(rules.teamId).toBe(team.id);
    expect(rules.schemaVersion).toBe(1);
  });

  it('rejects automatic incoming-trade acceptance', () => {
    const team = teamFixture();
    const result = teamConfigV1Schema.safeParse({
      ...team,
      automation: { ...team.automation, incomingTradeAccepts: true },
    });

    expect(result.success).toBe(false);
  });

  it('requires ordered uncertainty percentiles', () => {
    const result = projectionV1Schema.safeParse({
      schemaVersion: 1,
      id: randomUUID(),
      teamId: randomUUID(),
      playerId: randomUUID(),
      season: 2026,
      week: 1,
      horizon: 'weekly',
      p10: 20,
      p50: 15,
      p90: 30,
      replacementValue: 4,
      modelVersion: 'baseline-v1',
      generatedAt: now,
      sourceSnapshotIds: [],
    });

    expect(result.success).toBe(false);
  });
});
