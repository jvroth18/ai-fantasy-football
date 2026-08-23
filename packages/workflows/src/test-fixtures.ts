import { randomUUID } from 'node:crypto';

import type { LeagueRuleSetV1, StrategyProfileV1 } from '@ai-ff/domain';

import type { DecisionPlayer } from './types.js';

export const testNow = '2026-08-23T18:00:00.000Z';

export function playerFixture(overrides: Partial<DecisionPlayer> = {}): DecisionPlayer {
  return {
    playerId: randomUUID(),
    name: 'Example Player',
    position: 'RB',
    nflTeam: 'BUF',
    byeWeek: 7,
    p10: 8,
    p50: 15,
    p90: 24,
    replacementValue: 6,
    adp: 30,
    tier: 2,
    injuryRisk: 0.1,
    breakoutScore: 0.5,
    bustRisk: 0.15,
    mappingConfidence: 1,
    ...overrides,
  };
}

export function strategyFixture(overrides: Partial<StrategyProfileV1> = {}): StrategyProfileV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId: randomUUID(),
    name: 'Balanced upside',
    riskTolerance: 0.55,
    faabAggressiveness: 0.6,
    benchChurn: 0.5,
    preferStacks: true,
    preferHandcuffs: false,
    positionWeights: {},
    protectedPlayerIds: [],
    blockedPlayerIds: [],
    targetPlayerIds: [],
    maximumTradeOffersPerOpponentPerWeek: 1,
    createdAt: testNow,
    updatedAt: testNow,
    ...overrides,
  };
}

export function rulesFixture(): LeagueRuleSetV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId: randomUUID(),
    name: 'Test PPR',
    season: 2026,
    platform: 'espn',
    status: 'active',
    revision: 1,
    scoring: [
      {
        stat: 'receptions',
        label: 'Reception',
        pointsPerUnit: 1,
        unitSize: 1,
        bonuses: [],
        evidence: [],
      },
    ],
    roster: [
      { slot: 'QB', count: 1, starter: true, eligiblePositions: ['QB'] },
      { slot: 'RB', count: 1, starter: true, eligiblePositions: ['RB'] },
      { slot: 'WR', count: 1, starter: true, eligiblePositions: ['WR'] },
      { slot: 'FLEX', count: 1, starter: true, eligiblePositions: ['RB', 'WR', 'TE'] },
      { slot: 'BENCH', count: 5, starter: false, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] },
    ],
    draft: { type: 'snake', teamCount: 12, rounds: 15, secondsPerPick: 90, auctionBudget: null },
    waivers: {
      type: 'faab',
      budget: 100,
      minimumBid: 0,
      processingDays: [3],
      processingTimeLocal: '03:00',
      freeAgentMode: 'first_come',
      maxAcquisitionsPerWeek: null,
      tiebreaker: 'bid_timestamp',
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
    createdAt: testNow,
  };
}

export function automationFixture() {
  return {
    armed: true,
    lineupChanges: true,
    waiverClaims: true,
    freeAgentMoves: true,
    draftPicks: true,
    outgoingTradeOffers: true,
    incomingTradeAccepts: false as const,
    maxFaabPerClaim: 20,
    maxFaabPerWeek: 30,
    minimumFaabReserve: 10,
    maximumDraftReach: 12,
    minimumDataFreshnessMinutes: 180,
  };
}
