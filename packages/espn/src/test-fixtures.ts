import { randomUUID } from 'node:crypto';

import type { ActionIntentV1, TeamConfigV1 } from '@ai-ff/domain';

import type { EspnPortalSnapshot } from './schemas.js';
import type { ExecutionContext } from './types.js';

export const fixtureNow = '2026-08-23T18:00:00.000Z';

export function teamFixture(overrides: Partial<TeamConfigV1> = {}): TeamConfigV1 {
  const team: TeamConfigV1 = {
    schemaVersion: 1,
    id: randomUUID(),
    name: 'Fourth and Goal',
    platform: 'espn',
    season: 2026,
    timeZone: 'America/New_York',
    color: '#b9f55b',
    espnLeagueId: 'league-1',
    espnTeamId: 'team-7',
    activeRuleSetId: null,
    strategyProfileId: null,
    automation: {
      armed: true,
      lineupChanges: true,
      waiverClaims: true,
      freeAgentMoves: true,
      draftPicks: true,
      outgoingTradeOffers: true,
      incomingTradeAccepts: false,
      maxFaabPerClaim: 25,
      maxFaabPerWeek: 40,
      minimumFaabReserve: 10,
      maximumDraftReach: 24,
      minimumDataFreshnessMinutes: 180,
    },
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  };
  return { ...team, ...overrides };
}

export function intentFixture(
  teamId: string,
  type: ActionIntentV1['type'] = 'lineup_change',
  payload: Record<string, unknown> = {
    playerInId: 'bench-rb',
    playerOutId: 'starter-rb',
    targetSlot: 'RB',
  },
): ActionIntentV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    recommendationId: null,
    type,
    payload,
    idempotencyKey: `${teamId}:${type}:${randomUUID()}`,
    status: 'proposed',
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  };
}

export function snapshotFixture(): EspnPortalSnapshot {
  return {
    signedIn: true,
    leagueId: 'league-1',
    teamId: 'team-7',
    page: 'clubhouse',
    roster: [
      {
        playerId: 'starter-rb',
        name: 'Starter Runner',
        position: 'RB',
        nflTeam: 'NYJ',
        slot: 'RB',
        locked: false,
      },
      {
        playerId: 'bench-rb',
        name: 'Breakout Runner',
        position: 'RB',
        nflTeam: 'BUF',
        slot: 'BENCH',
        locked: false,
      },
    ],
    availablePlayers: [
      {
        playerId: 'free-wr',
        name: 'Available Receiver',
        position: 'WR',
        nflTeam: 'GB',
      },
      {
        playerId: 'rookie-wr',
        name: 'Rookie Receiver',
        position: 'WR',
        nflTeam: 'DAL',
      },
    ],
    waiverClaims: [],
    tradeOffers: [],
    draft: { status: 'live', onClockTeamId: 'team-7', picks: [] },
    observedAt: fixtureNow,
  };
}

export function contextFixture(
  team: TeamConfigV1,
  intent: ActionIntentV1,
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    team,
    intent,
    dataObservedAt: '2026-08-23T17:30:00.000Z',
    now: fixtureNow,
    faabRemaining: 100,
    faabSpentThisWeek: 0,
    ...overrides,
  };
}
