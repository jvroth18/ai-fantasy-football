import { randomUUID } from 'node:crypto';

import type {
  ActionIntentV1,
  AutomationRunV1,
  RecommendationV1,
  StrategyProfileV1,
  TeamConfigV1,
} from '@ai-ff/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type DatabaseHandle } from './database.js';
import { TeamRepository } from './repositories.js';
import {
  ActionExecutionRepository,
  ActionIntentRepository,
  AutomationRunRepository,
  CodexThreadRepository,
  JobLeaseRepository,
  RecommendationRepository,
  StrategyRepository,
} from './workflow-repositories.js';

const now = '2026-08-23T18:00:00.000Z';
const later = '2026-08-24T18:00:00.000Z';
const handles: DatabaseHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

function teamFixture(espnTeamId: string): TeamConfigV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    name: `Team ${espnTeamId}`,
    platform: 'espn',
    season: 2026,
    timeZone: 'America/New_York',
    color: '#b9f55b',
    espnLeagueId: 'league-1',
    espnTeamId,
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

function setup() {
  const handle = openDatabase();
  handles.push(handle);
  const teams = new TeamRepository(handle.db);
  const teamA = teams.create(teamFixture('1'));
  const teamB = teams.create(teamFixture('2'));
  return { handle, teams, teamA, teamB };
}

function strategyFixture(teamId: string): StrategyProfileV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    name: 'Balanced',
    riskTolerance: 0.5,
    faabAggressiveness: 0.5,
    benchChurn: 0.5,
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

function recommendationFixture(teamId: string): RecommendationV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    type: 'waiver',
    title: 'Add the breakout receiver',
    rationale: 'Usage and projections both improved.',
    projectedPointDelta: 3.2,
    projectedWinProbabilityDelta: 0.04,
    risk: 0.3,
    confidence: 0.8,
    evidence: [
      {
        sourceType: 'provider',
        sourceName: 'test',
        sourceDigest: '12345678',
        confidence: 1,
        observedAt: now,
      },
    ],
    alternativeIds: [],
    createdAt: now,
    expiresAt: later,
  };
}

function intentFixture(teamId: string, idempotencyKey: string): ActionIntentV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    recommendationId: null,
    type: 'lineup_change',
    payload: { playerInId: 'a', playerOutId: 'b', targetSlot: 'RB' },
    idempotencyKey,
    status: 'proposed',
    createdAt: now,
    updatedAt: now,
  };
}

function runFixture(teamId: string, status: AutomationRunV1['status']): AutomationRunV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    jobType: 'daily_manager',
    actionIntentId: null,
    status,
    attempt: 1,
    errorCode: status === 'failed' ? 'TEST_FAILURE' : null,
    errorMessage: status === 'failed' ? 'failed in test' : null,
    scheduledFor: now,
    startedAt: now,
    finishedAt: now,
  };
}

describe('workflow persistence', () => {
  it('keeps strategies and active recommendations scoped to their team', () => {
    const { handle, teams, teamA, teamB } = setup();
    const strategies = new StrategyRepository(handle.db);
    const recommendations = new RecommendationRepository(handle.db);
    const profile = strategies.save(strategyFixture(teamA.id));
    const recommendation = recommendations.save(recommendationFixture(teamA.id));

    expect(teams.getById(teamA.id)?.strategyProfileId).toBe(profile.id);
    expect(strategies.getForTeam(teamB.id, profile.id)).toBeNull();
    expect(recommendations.listActive(teamA.id, now)).toEqual([recommendation]);
    expect(recommendations.listActive(teamB.id, now)).toEqual([]);
  });

  it('atomically replaces only the requested active recommendation types', () => {
    const { handle, teamA } = setup();
    const recommendations = new RecommendationRepository(handle.db);
    const oldWaiver = recommendations.save(recommendationFixture(teamA.id));
    const trade = recommendations.save({
      ...recommendationFixture(teamA.id),
      type: 'trade',
      title: 'Trade for a receiver',
    });
    const replacement = {
      ...recommendationFixture(teamA.id),
      title: 'Add the new top receiver',
      createdAt: '2026-08-23T19:00:00.000Z',
    };

    expect(
      recommendations.replaceActiveForTypes(
        teamA.id,
        ['waiver'],
        [replacement],
        replacement.createdAt,
      ),
    ).toEqual([replacement]);
    expect(recommendations.listActive(teamA.id, replacement.createdAt)).toEqual([
      replacement,
      trade,
    ]);
    expect(recommendations.listActive(teamA.id, now)).toContainEqual(oldWaiver);
  });

  it('allows the same idempotency text for independent teams but not different actions on one team', () => {
    const { handle, teamA, teamB } = setup();
    const actions = new ActionIntentRepository(handle.db);
    const sharedKey = 'shared-idempotency-key';
    const actionA = actions.save(intentFixture(teamA.id, sharedKey));
    const actionB = actions.save(intentFixture(teamB.id, sharedKey));

    expect(actions.getByIdempotencyKey(teamA.id, sharedKey)?.id).toBe(actionA.id);
    expect(actions.getByIdempotencyKey(teamB.id, sharedKey)?.id).toBe(actionB.id);
    expect(() => actions.save(intentFixture(teamA.id, sharedKey))).toThrow(
      'already belongs to another action intent',
    );
  });

  it('persists action evidence and Codex threads behind team-scoped keys', () => {
    const { handle, teamA, teamB } = setup();
    const actions = new ActionIntentRepository(handle.db);
    const executions = new ActionExecutionRepository(handle.db);
    const threads = new CodexThreadRepository(handle.db);
    const intent = actions.save(intentFixture(teamA.id, 'execution-key-1234'));
    executions.put({
      id: randomUUID(),
      teamId: teamA.id,
      actionIntentId: intent.id,
      idempotencyKey: intent.idempotencyKey,
      outcome: 'verified',
      result: { beforeDigest: 'before', afterDigest: 'after' },
      createdAt: now,
      updatedAt: now,
    });

    expect(
      executions.get<{ afterDigest: string }>(teamA.id, intent.idempotencyKey)?.result,
    ).toEqual({
      beforeDigest: 'before',
      afterDigest: 'after',
    });
    expect(executions.get(teamB.id, intent.idempotencyKey)).toBeNull();

    const first = threads.upsert({
      id: randomUUID(),
      teamId: teamA.id,
      purpose: 'daily_manager',
      codexThreadId: 'codex-thread-1',
      updatedAt: now,
    });
    const updated = threads.upsert({
      id: randomUUID(),
      teamId: teamA.id,
      purpose: 'daily_manager',
      codexThreadId: 'codex-thread-2',
      updatedAt: later,
    });
    expect(updated.id).toBe(first.id);
    expect(threads.get(teamA.id, 'daily_manager')?.codexThreadId).toBe('codex-thread-2');
  });

  it('records the last successful job separately for each team', () => {
    const { handle, teamA, teamB } = setup();
    const runs = new AutomationRunRepository(handle.db);
    runs.save(runFixture(teamA.id, 'failed'));
    const successful = runs.save(runFixture(teamA.id, 'verified'));

    expect(runs.lastSuccessful(teamA.id, 'daily_manager')?.id).toBe(successful.id);
    expect(runs.lastSuccessful(teamB.id, 'daily_manager')).toBeNull();
    expect(runs.listRecent(teamA.id)).toHaveLength(2);
  });

  it('prevents overlapping jobs and permits takeover only after lease expiry', () => {
    const { handle, teamA } = setup();
    const leases = new JobLeaseRepository(handle.db);

    expect(
      leases.acquire(
        teamA.id,
        'daily_manager',
        'owner-a',
        '2026-08-23T18:00:00.000Z',
        '2026-08-23T18:15:00.000Z',
      ),
    ).toBe(true);
    expect(
      leases.acquire(
        teamA.id,
        'daily_manager',
        'owner-b',
        '2026-08-23T18:10:00.000Z',
        '2026-08-23T18:25:00.000Z',
      ),
    ).toBe(false);
    expect(
      leases.acquire(
        teamA.id,
        'daily_manager',
        'owner-b',
        '2026-08-23T18:15:00.000Z',
        '2026-08-23T18:30:00.000Z',
      ),
    ).toBe(true);
    expect(leases.release(teamA.id, 'daily_manager', 'owner-a')).toBe(false);
    expect(leases.release(teamA.id, 'daily_manager', 'owner-b')).toBe(true);
  });
});
