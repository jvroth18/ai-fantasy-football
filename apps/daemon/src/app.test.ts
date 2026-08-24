import { randomUUID } from 'node:crypto';

import type { LeagueRuleSetV1, TeamConfigV1 } from '@ai-ff/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from './app.js';

const now = '2026-08-23T18:00:00.000Z';
const servers: Awaited<ReturnType<typeof buildServer>>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function server(options: Parameters<typeof buildServer>[0] = {}) {
  const app = await buildServer({ now: () => new Date(now), ...options });
  servers.push(app);
  return app;
}

async function createTeam(
  app: Awaited<ReturnType<typeof buildServer>>,
  overrides: Record<string, unknown> = {},
): Promise<TeamConfigV1> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/teams',
    payload: {
      name: 'Fourth and Goal',
      season: 2026,
      timeZone: 'America/New_York',
      color: '#b9f55b',
      espnLeagueId: 'league-1',
      espnTeamId: 'team-7',
      ...overrides,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<TeamConfigV1>();
}

function rulesFixture(): LeagueRuleSetV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId: randomUUID(),
    name: 'PPR',
    season: 2025,
    platform: 'espn',
    status: 'active',
    revision: 8,
    scoring: [
      {
        stat: 'receptions',
        label: 'Receptions',
        pointsPerUnit: 1,
        unitSize: 1,
        bonuses: [],
        evidence: [],
      },
    ],
    roster: [
      { slot: 'QB', count: 1, starter: true, eligiblePositions: ['QB'] },
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
    createdAt: now,
  };
}

describe('local daemon API', () => {
  it('reports a loopback-ready service', async () => {
    const app = await server();
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'ai-fantasy-football-daemon' });
  });

  it('creates independently safe teams and exposes bootstrap readiness', async () => {
    const app = await server({
      codexReadiness: async () => ({
        authenticated: true,
        accountKind: 'chatgpt',
        models: [],
        skills: [],
        computerUseAvailable: true,
        readyForDecisions: true,
        readyForEspn: true,
        issues: [],
      }),
    });
    const first = await createTeam(app);
    const second = await createTeam(app, { name: 'Dynasty Lab', espnTeamId: 'team-8' });
    const bootstrap = await app.inject({ method: 'GET', url: '/api/bootstrap' });

    expect(first.automation.armed).toBe(false);
    expect(second.id).not.toBe(first.id);
    expect(bootstrap.json()).toMatchObject({
      teams: [{ id: second.id }, { id: first.id }],
      codex: { readyForEspn: true },
    });
  });

  it('uploads, reviews, and explicitly activates a versioned rule set', async () => {
    const app = await server();
    const team = await createTeam(app);
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/rules/import`,
      payload: {
        name: 'rules.json',
        mimeType: 'application/json',
        contentBase64: Buffer.from(JSON.stringify(rulesFixture())).toString('base64'),
      },
    });

    expect(uploaded.statusCode).toBe(201);
    const ruleSet = uploaded.json<{ ruleSet: LeagueRuleSetV1 }>().ruleSet;
    expect(ruleSet).toMatchObject({ teamId: team.id, status: 'draft', revision: 1 });

    const activated = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/rules/${ruleSet.id}/activate`,
    });
    expect(activated.json<TeamConfigV1>().activeRuleSetId).toBe(ruleSet.id);

    const detail = await app.inject({ method: 'GET', url: `/api/teams/${team.id}` });
    expect(detail.json<{ rules: LeagueRuleSetV1[] }>().rules[0]?.status).toBe('active');
  });

  it('requires an exact phrase before arming any ESPN mutation policy', async () => {
    const app = await server();
    const team = await createTeam(app);
    const policy = { ...team.automation, armed: true, lineupChanges: true };

    const rejected = await app.inject({
      method: 'PUT',
      url: `/api/teams/${team.id}/automation`,
      payload: { policy },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: 'ARMING_CONFIRMATION_REQUIRED' });

    const armed = await app.inject({
      method: 'PUT',
      url: `/api/teams/${team.id}/automation`,
      payload: { policy, confirmation: 'ARM ESPN AUTOMATION' },
    });
    expect(armed.json<TeamConfigV1>().automation).toMatchObject({
      armed: true,
      lineupChanges: true,
      incomingTradeAccepts: false,
    });
  });

  it('saves a strategy and manually triggers a configured management job', async () => {
    const trigger = vi.fn(async () => ({
      schemaVersion: 1 as const,
      id: randomUUID(),
      teamId: '',
      jobType: 'daily_manager',
      actionIntentId: null,
      status: 'verified' as const,
      attempt: 1,
      errorCode: null,
      errorMessage: null,
      scheduledFor: now,
      startedAt: now,
      finishedAt: now,
    }));
    const app = await server({ scheduler: { entries: () => [], trigger } });
    const team = await createTeam(app);
    const strategy = await app.inject({
      method: 'PUT',
      url: `/api/teams/${team.id}/strategy`,
      payload: {
        name: 'Upside balanced',
        riskTolerance: 0.6,
        faabAggressiveness: 0.7,
        benchChurn: 0.5,
        preferStacks: true,
        preferHandcuffs: false,
        positionWeights: { RB: 1.2 },
        protectedPlayerIds: [],
        blockedPlayerIds: [],
        targetPlayerIds: [],
        maximumTradeOffersPerOpponentPerWeek: 1,
      },
    });
    expect(strategy.statusCode).toBe(200);

    const run = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/jobs/daily_manager/run`,
    });
    expect(run.statusCode).toBe(200);
    expect(trigger).toHaveBeenCalledWith(team.id, 'daily_manager');
  });

  it('exposes explicit read-only ESPN sync without enabling mutations', async () => {
    const sync = vi.fn(async (team: TeamConfigV1) => ({
      id: randomUUID(),
      teamId: team.id,
      leagueId: team.espnLeagueId,
      platformTeamId: team.espnTeamId,
      digest: 'a'.repeat(64),
      observedAt: now,
      capturedAt: now,
      snapshot: {
        signedIn: true,
        leagueId: team.espnLeagueId,
        teamId: team.espnTeamId,
        page: 'clubhouse' as const,
        roster: [],
        availablePlayers: [],
        leagueTeams: [],
        waiverClaims: [],
        tradeOffers: [],
        draft: {
          status: 'pre_draft' as const,
          onClockTeamId: null,
          draftSlot: 7,
          picks: [],
        },
        observedAt: now,
      },
    }));
    const app = await server({ espnSnapshots: { sync } });
    const team = await createTeam(app);

    const before = await app.inject({
      method: 'GET',
      url: `/api/teams/${team.id}/espn/snapshot`,
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toBeNull();

    const response = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/espn/sync`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      teamId: team.id,
      snapshot: { signedIn: true, leagueId: team.espnLeagueId, teamId: team.espnTeamId },
    });
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ id: team.id }));
    expect(team.automation.armed).toBe(false);
  });
});
