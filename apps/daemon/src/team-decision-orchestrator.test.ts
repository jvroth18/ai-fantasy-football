import { randomUUID } from 'node:crypto';

import {
  DataSnapshotRepository,
  openDatabase,
  PortalSnapshotRepository,
  RecommendationRepository,
  RuleSetRepository,
  StrategyRepository,
  TeamRepository,
  type DatabaseHandle,
} from '@ai-ff/db';
import type { LeagueRuleSetV1, StrategyProfileV1, TeamConfigV1 } from '@ai-ff/domain';
import type { EspnPortalSnapshot } from '@ai-ff/espn';
import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerValueProvider, PlayerValueRequest } from './codex-player-values.js';
import { portalSnapshotDigest } from './espn-snapshot-service.js';
import { TeamDecisionOrchestrator } from './team-decision-orchestrator.js';

const now = '2026-08-23T18:00:00.000Z';
const databases: DatabaseHandle[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function teamFixture(): TeamConfigV1 {
  return {
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
      armed: false,
      lineupChanges: false,
      waiverClaims: false,
      freeAgentMoves: false,
      draftPicks: false,
      outgoingTradeOffers: false,
      incomingTradeAccepts: false,
      maxFaabPerClaim: 25,
      maxFaabPerWeek: 40,
      minimumFaabReserve: 10,
      maximumDraftReach: 24,
      minimumDataFreshnessMinutes: 180,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function ruleFixture(teamId: string): LeagueRuleSetV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    name: 'PPR league',
    season: 2026,
    platform: 'espn',
    status: 'draft',
    revision: 1,
    scoring: [
      {
        stat: 'receiving_receptions',
        label: 'Reception',
        pointsPerUnit: 1,
        unitSize: 1,
        bonuses: [],
        evidence: [],
      },
    ],
    roster: [
      { slot: 'RB', count: 1, starter: true, eligiblePositions: ['RB'] },
      { slot: 'WR', count: 1, starter: true, eligiblePositions: ['WR'] },
      {
        slot: 'BENCH',
        count: 5,
        starter: false,
        eligiblePositions: ['QB', 'RB', 'WR', 'TE'],
      },
    ],
    draft: {
      type: 'snake',
      teamCount: 12,
      rounds: 15,
      secondsPerPick: 90,
      auctionBudget: null,
    },
    waivers: {
      type: 'faab',
      budget: 100,
      minimumBid: 0,
      processingDays: [3],
      processingTimeLocal: '11:00',
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
      deadlineWeek: 11,
      reviewType: 'league_vote',
      reviewHours: 24,
      futureDraftPicksAllowed: false,
    },
    evidence: [],
    createdAt: now,
  };
}

function strategyFixture(teamId: string): StrategyProfileV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    name: 'Balanced',
    riskTolerance: 0.5,
    faabAggressiveness: 0.5,
    benchChurn: 0.8,
    preferStacks: false,
    preferHandcuffs: false,
    positionWeights: {},
    protectedPlayerIds: [],
    blockedPlayerIds: [],
    targetPlayerIds: [],
    maximumTradeOffersPerOpponentPerWeek: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function snapshotFixture(overrides: Partial<EspnPortalSnapshot> = {}): EspnPortalSnapshot {
  return {
    signedIn: true,
    leagueId: 'league-1',
    teamId: 'team-7',
    page: 'clubhouse',
    roster: [
      {
        playerId: 'starter-rb',
        name: 'Steady Runner',
        position: 'RB',
        nflTeam: 'NYJ',
        availability: 'active',
        slot: 'RB',
        locked: false,
      },
      {
        playerId: 'bench-rb',
        name: 'Breakout Runner',
        position: 'RB',
        nflTeam: 'BUF',
        availability: 'active',
        slot: 'BENCH',
        locked: false,
      },
      {
        playerId: 'starter-wr',
        name: 'Starting Receiver',
        position: 'WR',
        nflTeam: 'GB',
        availability: 'active',
        slot: 'WR',
        locked: false,
      },
      {
        playerId: 'drop-te',
        name: 'Replacement Tight End',
        position: 'TE',
        nflTeam: 'CLE',
        availability: 'active',
        slot: 'BENCH',
        locked: false,
      },
    ],
    availablePlayers: [
      {
        playerId: 'waiver-wr',
        name: 'Waiver Receiver',
        position: 'WR',
        nflTeam: 'DAL',
        availability: 'active',
        acquisitionType: 'waiver',
        rosteredPercent: 55,
      },
    ],
    leagueTeams: [],
    faabRemaining: 90,
    faabSpentThisWeek: 5,
    waiverClaims: [],
    tradeOffers: [],
    draft: { status: 'complete', onClockTeamId: null, draftSlot: 7, picks: [] },
    observedAt: now,
    ...overrides,
  };
}

class FakeValues implements PlayerValueProvider {
  constructor(readonly medians: Record<string, number>) {}

  async valuePlayers(request: PlayerValueRequest) {
    return request.players.map((player, index) => {
      const p50 = this.medians[player.playerId] ?? 10 + index;
      return {
        ...player,
        byeWeek: 7,
        p10: Math.max(0, p50 - 4),
        p50,
        p90: p50 + 5,
        replacementValue: 8,
        adp: 20 + index * 5,
        tier: 2 + index,
        injuryRisk: 0.1,
        breakoutScore: player.playerId.includes('bench') ? 0.8 : 0.4,
        bustRisk: 0.2,
        mappingConfidence: 0.98,
        rationale: `${player.name} test valuation.`,
        sourceUrls: ['https://example.com/rankings'],
      };
    });
  }
}

function setup(
  snapshot: EspnPortalSnapshot,
  values: Record<string, number>,
  customizeRules?: (rules: LeagueRuleSetV1) => LeagueRuleSetV1,
) {
  const database = openDatabase();
  databases.push(database);
  const teams = new TeamRepository(database.db);
  let team = teams.create(teamFixture());
  const rules = customizeRules?.(ruleFixture(team.id)) ?? ruleFixture(team.id);
  new RuleSetRepository(database.db).create(rules);
  team = teams.activateRuleSet(team.id, rules.id, now);
  new StrategyRepository(database.db).save(strategyFixture(team.id));
  team = teams.getById(team.id) as TeamConfigV1;
  new DataSnapshotRepository(database.db).record({
    id: randomUUID(),
    provider: 'sleeper',
    sourceUrl: 'https://api.sleeper.app/v1/players/nfl',
    digest: 'a'.repeat(64),
    recordCount: 0,
    status: 'complete',
    fetchedAt: now,
    metadataJson: JSON.stringify({ adds: [], drops: [] }),
  });
  new PortalSnapshotRepository(database.db).record({
    id: randomUUID(),
    teamId: team.id,
    leagueId: snapshot.leagueId,
    platformTeamId: snapshot.teamId,
    digest: portalSnapshotDigest(snapshot),
    snapshotJson: JSON.stringify(snapshot),
    observedAt: snapshot.observedAt,
    capturedAt: now,
  });
  const orchestrator = new TeamDecisionOrchestrator(database.db, new FakeValues(values), {
    now: () => new Date(now),
  });
  return { database, team, orchestrator };
}

describe('TeamDecisionOrchestrator', () => {
  it('refreshes deterministic lineup and waiver recommendations from one team snapshot', async () => {
    const { database, team, orchestrator } = setup(snapshotFixture(), {
      'starter-rb': 8,
      'bench-rb': 18,
      'starter-wr': 12,
      'drop-te': 3,
      'waiver-wr': 20,
    });

    const result = await orchestrator.analyze(team, 'daily_manager');
    const recommendations = new RecommendationRepository(database.db).listActive(team.id, now);

    expect(result).toMatchObject({ status: 'verified' });
    expect(new Set(recommendations.map((item) => item.type))).toEqual(
      new Set(['lineup', 'waiver']),
    );
    expect(recommendations.find((item) => item.type === 'lineup')?.rationale).toContain(
      'Breakout Runner',
    );
    expect(recommendations.find((item) => item.type === 'lineup')?.action).toEqual({
      type: 'lineup_change',
      payload: {
        playerInId: 'bench-rb',
        playerOutId: 'starter-rb',
        targetSlot: 'RB',
      },
    });
    expect(recommendations.find((item) => item.type === 'waiver')?.title).toContain(
      'Waiver Receiver',
    );
    expect(recommendations.find((item) => item.type === 'waiver')?.action?.type).toBe(
      'waiver_claim',
    );
    expect(recommendations.every((item) => item.evidence.length >= 3)).toBe(true);
  });

  it('generates only mutually beneficial, needs-aware trade proposals', async () => {
    const snapshot = snapshotFixture({
      roster: [
        {
          playerId: 'own-rb',
          name: 'Own Runner',
          position: 'RB',
          nflTeam: 'NYJ',
          availability: 'active',
          slot: 'RB',
          locked: false,
        },
        {
          playerId: 'own-wr',
          name: 'Own Receiver',
          position: 'WR',
          nflTeam: 'GB',
          availability: 'active',
          slot: 'WR',
          locked: false,
        },
      ],
      availablePlayers: [],
      leagueTeams: [
        {
          teamId: 'opponent-2',
          name: 'Sunday Rivals',
          roster: [
            {
              playerId: 'opp-rb-1',
              name: 'Opponent Runner One',
              position: 'RB',
              nflTeam: 'BUF',
              availability: 'active',
            },
            {
              playerId: 'opp-rb-2',
              name: 'Opponent Runner Two',
              position: 'RB',
              nflTeam: 'DAL',
              availability: 'active',
            },
          ],
        },
      ],
    });
    const { database, team, orchestrator } = setup(
      snapshot,
      { 'own-rb': 13, 'own-wr': 13, 'opp-rb-1': 13, 'opp-rb-2': 13 },
      (rules) => ({
        ...rules,
        roster: [
          { slot: 'RB', count: 2, starter: true, eligiblePositions: ['RB'] },
          { slot: 'WR', count: 1, starter: true, eligiblePositions: ['WR'] },
          {
            slot: 'BENCH',
            count: 5,
            starter: false,
            eligiblePositions: ['QB', 'RB', 'WR', 'TE'],
          },
        ],
      }),
    );

    const result = await orchestrator.analyze(team, 'trade_market');
    const recommendations = new RecommendationRepository(database.db).listActive(team.id, now);

    expect(result).toMatchObject({ status: 'verified' });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({ type: 'trade' });
    expect(recommendations[0]?.action?.type).toBe('trade_offer');
    expect(recommendations[0]?.rationale).toContain('Sunday Rivals');
  });

  it('builds a draft board while a draft is active', async () => {
    const snapshot = snapshotFixture({
      roster: [],
      availablePlayers: [
        {
          playerId: 'draft-rb',
          name: 'Rookie Runner',
          position: 'RB',
          nflTeam: 'ARI',
          availability: 'active',
          acquisitionType: 'unknown',
          rosteredPercent: null,
        },
        {
          playerId: 'draft-wr',
          name: 'Rookie Receiver',
          position: 'WR',
          nflTeam: 'TEN',
          availability: 'active',
          acquisitionType: 'unknown',
          rosteredPercent: null,
        },
      ],
      draft: { status: 'live', onClockTeamId: 'team-7', draftSlot: 1, picks: [] },
    });
    const { database, team, orchestrator } = setup(snapshot, {
      'draft-rb': 220,
      'draft-wr': 190,
    });

    const result = await orchestrator.analyze(team, 'daily_manager');
    const recommendations = new RecommendationRepository(database.db).listActive(team.id, now);

    expect(result).toMatchObject({ status: 'verified' });
    expect(recommendations).toHaveLength(2);
    expect(recommendations[0]?.type).toBe('draft');
    expect(recommendations.some((item) => item.title.includes('Rookie Runner'))).toBe(true);
  });

  it('fails closed on a stale snapshot when read-only refresh is unavailable', async () => {
    const stale = snapshotFixture({ observedAt: '2026-08-23T15:00:00.000Z' });
    const { team, orchestrator } = setup(stale, {});

    await expect(orchestrator.analyze(team, 'lineup_watch')).resolves.toMatchObject({
      status: 'needs_attention',
      errorCode: 'ESPN_SNAPSHOT_STALE',
    });
  });
});
