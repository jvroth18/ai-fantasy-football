import { randomUUID } from 'node:crypto';

import {
  ActionExecutionRepository,
  ActionIntentRepository,
  openDatabase,
  PortalSnapshotRepository,
  RecommendationRepository,
  TeamRepository,
  type DatabaseHandle,
} from '@ai-ff/db';
import type { RecommendationV1, TeamConfigV1 } from '@ai-ff/domain';
import { SimulatedEspnPortal, type EspnPortalSnapshot } from '@ai-ff/espn';
import { afterEach, describe, expect, it } from 'vitest';

import { EspnActionService } from './espn-action-service.js';
import { portalSnapshotDigest } from './espn-snapshot-service.js';

const now = '2026-08-23T18:00:00.000Z';
const later = '2026-08-24T18:00:00.000Z';
const databases: DatabaseHandle[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function teamFixture(armed = true): TeamConfigV1 {
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
      armed,
      lineupChanges: true,
      waiverClaims: false,
      freeAgentMoves: false,
      draftPicks: false,
      outgoingTradeOffers: false,
      incomingTradeAccepts: false,
      maxFaabPerClaim: 20,
      maxFaabPerWeek: 30,
      minimumFaabReserve: 10,
      maximumDraftReach: 24,
      minimumDataFreshnessMinutes: 180,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function snapshotFixture(): EspnPortalSnapshot {
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
    ],
    availablePlayers: [],
    leagueTeams: [],
    faabRemaining: 100,
    faabSpentThisWeek: 0,
    waiverClaims: [],
    tradeOffers: [],
    draft: { status: 'complete', onClockTeamId: null, draftSlot: 7, picks: [] },
    observedAt: now,
  };
}

function recommendationFixture(teamId: string): RecommendationV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    type: 'lineup',
    title: 'Start Breakout Runner',
    rationale: 'The projection is materially higher.',
    projectedPointDelta: 5,
    projectedWinProbabilityDelta: null,
    risk: 0.2,
    confidence: 0.9,
    evidence: [
      {
        sourceType: 'espn_scan',
        sourceName: 'test snapshot',
        sourceDigest: '12345678',
        confidence: 1,
        observedAt: now,
      },
    ],
    action: {
      type: 'lineup_change',
      payload: {
        playerInId: 'bench-rb',
        playerOutId: 'starter-rb',
        targetSlot: 'RB',
      },
    },
    alternativeIds: [],
    createdAt: now,
    expiresAt: later,
  };
}

function setup(armed = true) {
  const database = openDatabase();
  databases.push(database);
  const team = new TeamRepository(database.db).create(teamFixture(armed));
  const snapshot = snapshotFixture();
  new PortalSnapshotRepository(database.db).record({
    id: randomUUID(),
    teamId: team.id,
    leagueId: snapshot.leagueId,
    platformTeamId: snapshot.teamId,
    digest: portalSnapshotDigest(snapshot),
    snapshotJson: JSON.stringify(snapshot),
    observedAt: now,
    capturedAt: now,
  });
  const recommendation = new RecommendationRepository(database.db).save(
    recommendationFixture(team.id),
  );
  const simulator = new SimulatedEspnPortal(snapshot, () => now);
  const service = new EspnActionService(database.db, async () => simulator, {
    now: () => new Date(now),
  });
  return { database, team, recommendation, simulator, service };
}

describe('EspnActionService', () => {
  it('persists an exact intent, one portal attempt, read-back evidence, and observed snapshots', async () => {
    const { database, team, recommendation, simulator, service } = setup();

    const result = await service.executeRecommendation(team, recommendation.id);

    expect(result).toMatchObject({ outcome: 'verified', performed: true, replayed: false });
    expect(simulator.performCalls).toBe(1);
    expect(new ActionIntentRepository(database.db).listForTeam(team.id)).toEqual([result.intent]);
    expect(
      new ActionExecutionRepository(database.db).get(team.id, result.intent.idempotencyKey)
        ?.outcome,
    ).toBe('verified');
    expect(new PortalSnapshotRepository(database.db).listRecentForTeam(team.id)).toHaveLength(3);
  });

  it('replays a completed idempotency key without a second submission', async () => {
    const { team, recommendation, simulator, service } = setup();

    await service.executeRecommendation(team, recommendation.id);
    const replay = await service.executeRecommendation(team, recommendation.id);

    expect(replay).toMatchObject({ outcome: 'verified', performed: false, replayed: true });
    expect(simulator.performCalls).toBe(1);
  });

  it('records policy denial without opening a mutation attempt', async () => {
    const { team, recommendation, simulator, service } = setup(false);

    const result = await service.executeRecommendation(team, recommendation.id);

    expect(result).toMatchObject({ outcome: 'cancelled', errorCode: 'POLICY_DENIED' });
    expect(simulator.performCalls).toBe(0);
  });
});
