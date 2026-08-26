import { randomUUID } from 'node:crypto';

import { FanNetworkService } from './fan-network-service.js';
import type { LeagueRuleSetV1, TeamConfigV1 } from '@ai-ff/domain';
import { openDatabase } from '@ai-ff/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from './app.js';

const now = '2026-08-23T18:00:00.000Z';
const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
const databases: ReturnType<typeof openDatabase>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  databases.splice(0).forEach((database) => database.close());
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

  it('persists team-scoped members and human league posts', async () => {
    const app = await server();
    const team = await createTeam(app);
    const initial = await app.inject({ method: 'GET', url: `/api/teams/${team.id}` });
    const owner = initial.json<{ members: Array<{ id: string; displayName: string }> }>()
      .members[0]!;
    expect(owner).toMatchObject({ displayName: 'Commissioner' });

    const member = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/members`,
      payload: { displayName: 'Jordan' },
    });
    expect(member.statusCode).toBe(201);

    const post = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/posts`,
      payload: { memberId: member.json<{ id: string }>().id, body: 'Waiver night starts now.' },
    });
    expect(post.statusCode).toBe(201);
    expect(post.json()).toMatchObject({ authorName: 'Jordan', body: 'Waiver night starts now.' });

    const reaction = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/reactions/toggle`,
      payload: {
        memberId: owner.id,
        targetType: 'member_post',
        targetId: post.json<{ id: string }>().id,
      },
    });
    expect(reaction.json()).toEqual({ active: true });

    const comment = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/comments`,
      payload: {
        memberId: owner.id,
        targetType: 'member_post',
        targetId: post.json<{ id: string }>().id,
        body: 'I am ready.',
      },
    });
    expect(comment.statusCode).toBe(201);
    expect(comment.json()).toMatchObject({ authorName: 'Commissioner', body: 'I am ready.' });

    const detail = await app.inject({ method: 'GET', url: `/api/teams/${team.id}` });
    expect(detail.json<{ leaguePosts: Array<{ body: string }> }>().leaguePosts).toEqual([
      expect.objectContaining({ body: 'Waiver night starts now.' }),
    ]);
    expect(detail.json<{ leagueReactions: unknown[] }>().leagueReactions).toHaveLength(1);
    expect(detail.json<{ leagueComments: unknown[] }>().leagueComments).toHaveLength(1);

    const invalidPost = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/posts`,
      payload: { memberId: randomUUID(), body: 'Not a member.' },
    });
    expect(invalidPost.statusCode).toBe(404);
    expect(invalidPost.json()).toMatchObject({ error: 'LEAGUE_MEMBER_NOT_FOUND' });
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

  it('refreshes feed sources independently and reports skipped commentary truthfully', async () => {
    const trigger = vi.fn(async () => ({
      schemaVersion: 1 as const,
      id: randomUUID(),
      teamId: '',
      jobType: 'news_refresh' as const,
      actionIntentId: null,
      status: 'verified' as const,
      attempt: 1,
      errorCode: null,
      errorMessage: null,
      scheduledFor: now,
      startedAt: now,
      finishedAt: now,
    }));
    const sync = vi.fn(async () => undefined as never);
    const app = await server({
      scheduler: { entries: () => [], trigger },
      espnSnapshots: { sync },
    });
    const team = await createTeam(app);

    const refresh = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/feed/refresh`,
    });

    expect(refresh.statusCode).toBe(200);
    expect(refresh.json()).toMatchObject({
      status: 'complete',
      steps: {
        espn: { status: 'complete' },
        news: { status: 'complete' },
        commentary: { status: 'skipped' },
      },
    });
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ id: team.id }));
    expect(trigger).toHaveBeenCalledWith(team.id, 'news_refresh');
  });

  it('keeps fan desk configuration and generated posts scoped to the selected team', async () => {
    const app = await server({
      fanDesk: {
        profile: (team) => ({
          schemaVersion: 1,
          id: randomUUID(),
          teamId: team.id,
          name: 'The Stands',
          voice: 'superfan',
          heat: 0.7,
          rumorTolerance: 0.3,
          cadence: 'every_3_hours',
          enabled: true,
          emailEnabled: false,
          emailAddress: null,
          emailSubjectPrefix: 'Fan desk',
          createdAt: now,
          updatedAt: now,
        }),
        posts: () => [],
        emails: () => [],
        saveProfile: vi.fn((_team, input) => ({
          ...input,
          schemaVersion: 1,
          id: randomUUID(),
          teamId: _team.id,
          createdAt: now,
          updatedAt: now,
        })),
        generate: vi.fn(async (team) => ({
          post: {
            schemaVersion: 1 as const,
            id: randomUUID(),
            teamId: team.id,
            profileId: randomUUID(),
            kind: 'game_thread' as const,
            status: 'published' as const,
            headline: 'Test bulletin',
            dek: 'Test dek',
            body: 'Test body',
            stance: 'Test stance',
            heat: 0.5,
            evidence: [
              {
                sourceType: 'manual' as const,
                sourceName: 'test',
                sourceDigest: 'a'.repeat(64),
                confidence: 1,
                observedAt: now,
              },
            ],
            generatedBy: 'deterministic' as const,
            createdAt: now,
            emailedAt: null,
          },
          email: null,
          syncWarning: null,
        })),
        runScheduled: vi.fn(),
      },
    });
    const team = await createTeam(app);
    const profile = await app.inject({ method: 'GET', url: `/api/teams/${team.id}/fan-desk` });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ profile: { teamId: team.id, voice: 'superfan' } });

    const generated = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/fan-desk/generate`,
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({ post: { teamId: team.id } });
  });

  it('configures a team-scoped agent network and records an interactive event trace', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const app = await server({
      database,
      fanNetwork: new FanNetworkService(database.db, { now: () => new Date(now) }),
    });
    const team = await createTeam(app);

    const configured = await app.inject({
      method: 'PUT',
      url: `/api/teams/${team.id}/fan-network`,
      payload: {
        name: 'Sunday Night Network',
        enabled: true,
        agents: [
          {
            id: 'scout',
            name: 'Scout',
            role: 'observer',
            instructions: 'Watch the league.',
            model: {
              provider: 'none',
              modelId: 'deterministic',
              temperature: 0,
              maxOutputTokens: 200,
            },
            listensTo: ['fan.mention.received'],
            emits: ['league.signal.detected'],
            enabled: true,
            heat: 0.2,
            toolPermissions: { readPortal: true, readNews: true, publish: false, reply: false },
          },
        ],
        routes: [{ event: 'fan.mention.received', to: ['scout'], parallel: false }],
        policies: {
          requireEvidence: true,
          identifyAsAi: true,
          maxRepliesPerHour: 10,
          maxModelSpendPerDay: 1,
          maxTurnsPerEvent: 4,
          neverInventInjuries: true,
          neverAcceptTrades: true,
        },
      },
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json()).toMatchObject({
      name: 'Sunday Night Network',
      teamId: team.id,
      agents: [{ id: 'scout' }],
    });

    const emitted = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/fan-network/events`,
      payload: {
        type: 'fan.mention.received',
        payload: { text: 'Trade deadline chaos!' },
      },
    });
    expect(emitted.statusCode).toBe(200);
    expect(emitted.json()).toMatchObject({
      rootEvent: { type: 'fan.mention.received', teamId: team.id },
      events: [{ type: 'fan.mention.received' }, { type: 'league.signal.detected' }],
      runs: [{ agentId: 'scout', status: 'completed' }],
    });

    const detail = await app.inject({ method: 'GET', url: `/api/teams/${team.id}` });
    expect(detail.json()).toMatchObject({
      fanNetwork: {
        network: { name: 'Sunday Night Network' },
        events: [{ type: 'fan.mention.received' }, { type: 'league.signal.detected' }],
      },
    });
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
        faabRemaining: 100,
        faabSpentThisWeek: 0,
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

  it('requires explicit confirmation before handing a recommendation to the ESPN executor', async () => {
    const executeRecommendation = vi.fn(async (team: TeamConfigV1, recommendationId: string) => ({
      outcome: 'verified' as const,
      intent: {
        schemaVersion: 1 as const,
        id: randomUUID(),
        teamId: team.id,
        recommendationId,
        type: 'lineup_change' as const,
        payload: { playerInId: 'bench-rb', playerOutId: 'starter-rb', targetSlot: 'RB' },
        idempotencyKey: 'a'.repeat(64),
        status: 'verified' as const,
        createdAt: now,
        updatedAt: now,
      },
      performed: true,
      replayed: false,
      beforeDigest: 'b'.repeat(64),
      afterDigest: 'c'.repeat(64),
      evidence: ['Verified in test'],
      errorCode: null,
    }));
    const app = await server({ espnActions: { executeRecommendation } });
    const team = await createTeam(app);
    const recommendationId = randomUUID();

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/recommendations/${recommendationId}/execute`,
      payload: { confirmation: 'yes' },
    });
    expect(rejected.statusCode).toBe(400);
    expect(executeRecommendation).not.toHaveBeenCalled();

    const executed = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/recommendations/${recommendationId}/execute`,
      payload: { confirmation: 'EXECUTE ESPN ACTION' },
    });
    expect(executed.statusCode).toBe(200);
    expect(executed.json()).toMatchObject({ outcome: 'verified', performed: true });
    expect(executeRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({ id: team.id }),
      recommendationId,
    );
  });
});
