import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import type { CodexReadiness } from '@ai-ff/codex';
import {
  AutomationRunRepository,
  DataSnapshotRepository,
  openDatabase,
  PortalSnapshotRepository,
  PlayerIntelligenceRepository,
  RecommendationRepository,
  RuleSetRepository,
  StrategyRepository,
  TeamRepository,
  type DatabaseHandle,
} from '@ai-ff/db';
import {
  automationPolicySchema,
  fanEventTypeSchema,
  fanAgentSchema,
  fanDeskProfileV1Schema,
  fanNetworkPolicySchema,
  fanNetworkRouteSchema,
  sourceEvidenceSchema,
  strategyProfileV1Schema,
  type TeamConfigV1,
} from '@ai-ff/domain';
import { supportedRuleMimeTypes, type RuleSource } from '@ai-ff/rules';
import type { LocalTeamScheduler, ManagementJobType } from '@ai-ff/scheduler';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';

import { RuleImportService, type CodexRuleExtractor } from './rule-import-service.js';
import { portalSnapshotView, type EspnSnapshotService } from './espn-snapshot-service.js';
import type { EspnActionService } from './espn-action-service.js';
import type { FanDeskService } from './fan-desk-service.js';
import type { FanNetworkService } from './fan-network-service.js';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });
const ruleParamsSchema = teamParamsSchema.extend({ ruleSetId: z.string().uuid() });
const jobParamsSchema = teamParamsSchema.extend({
  jobType: z.enum([
    'news_refresh',
    'data_refresh',
    'daily_manager',
    'waiver_plan',
    'trade_market',
    'lineup_watch',
    'fan_digest',
  ]),
});
const recommendationParamsSchema = teamParamsSchema.extend({
  recommendationId: z.string().uuid(),
});
const executeRecommendationSchema = z.object({
  confirmation: z.literal('EXECUTE ESPN ACTION'),
});

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  season: z.number().int().min(2000).max(2100),
  timeZone: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  espnLeagueId: z.string().min(1),
  espnTeamId: z.string().min(1),
});

const updateTeamSchema = createTeamSchema
  .pick({ name: true, timeZone: true, color: true, espnLeagueId: true, espnTeamId: true })
  .partial();

const strategyInputSchema = strategyProfileV1Schema.omit({
  schemaVersion: true,
  id: true,
  teamId: true,
  createdAt: true,
  updatedAt: true,
});

const automationInputSchema = z.object({
  policy: automationPolicySchema,
  confirmation: z.string().optional(),
});

const uploadSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^/\\]+$/, 'File name cannot include a path'),
  mimeType: z.enum(supportedRuleMimeTypes),
  contentBase64: z.string().min(1),
});
const playerListQuerySchema = z.object({
  position: z.enum(['QB', 'RB', 'WR', 'TE', 'K', 'DST']).optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});
const playerParamsSchema = z.object({ playerId: z.string().uuid() });
const playerExportQuerySchema = z.object({ format: z.enum(['json', 'jsonl']).default('json') });
const fanDeskInputSchema = fanDeskProfileV1Schema.omit({
  schemaVersion: true,
  id: true,
  teamId: true,
  createdAt: true,
  updatedAt: true,
});
const fanNetworkInputSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  agents: z.array(fanAgentSchema).min(1).max(32),
  routes: z.array(fanNetworkRouteSchema).min(1).max(64),
  policies: fanNetworkPolicySchema,
});
const fanNetworkEventInputSchema = z.object({
  type: fanEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  evidence: z.array(sourceEvidenceSchema).default([]),
  correlationId: z.string().uuid().optional(),
});

export type ServerOptions = {
  logger?: boolean;
  database?: DatabaseHandle;
  scheduler?: Pick<LocalTeamScheduler, 'entries' | 'trigger'> &
    Partial<Pick<LocalTeamScheduler, 'start'>>;
  ruleExtractor?: CodexRuleExtractor | null;
  espnSnapshots?: Pick<EspnSnapshotService, 'sync'> | null;
  espnActions?: Pick<EspnActionService, 'executeRecommendation'> | null;
  fanDesk?: Pick<
    FanDeskService,
    'profile' | 'saveProfile' | 'posts' | 'emails' | 'generate' | 'runScheduled'
  > | null;
  fanNetwork?: Pick<
    FanNetworkService,
    'network' | 'saveNetwork' | 'events' | 'runs' | 'dispatch'
  > | null;
  codexReadiness?: (() => Promise<CodexReadiness>) | null;
  now?: () => Date;
};

function safeTeamInput(input: z.infer<typeof createTeamSchema>, now: string): TeamConfigV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    name: input.name,
    platform: 'espn',
    season: input.season,
    timeZone: input.timeZone,
    color: input.color,
    espnLeagueId: input.espnLeagueId,
    espnTeamId: input.espnTeamId,
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

function decodeUpload(contentBase64: string): Uint8Array {
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(contentBase64) || contentBase64.length % 4 !== 0) {
    throw new Error('Rule upload is not valid base64');
  }
  const bytes = Buffer.from(contentBase64, 'base64');
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Rule upload exceeds 10 MB');
  return bytes;
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 14 * 1024 * 1024 });
  const now = options.now ?? (() => new Date());
  const database = options.database ?? openDatabase();
  const ownsDatabase = options.database === undefined;
  const teams = new TeamRepository(database.db);
  const ruleSets = new RuleSetRepository(database.db);
  const strategies = new StrategyRepository(database.db);
  const recommendations = new RecommendationRepository(database.db);
  const runs = new AutomationRunRepository(database.db);
  const snapshots = new DataSnapshotRepository(database.db);
  const portalSnapshots = new PortalSnapshotRepository(database.db);
  const playerIntelligence = new PlayerIntelligenceRepository(database.db);
  const ruleImports = new RuleImportService(teams, ruleSets, options.ruleExtractor ?? null, now);

  await app.register(cors, {
    origin: ['http://127.0.0.1:4317', 'http://localhost:4317'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  if (ownsDatabase) app.addHook('onClose', async () => database.close());

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      void reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Team not found') {
      void reply.code(404).send({ error: 'NOT_FOUND', message });
      return;
    }
    if (message.includes('Codex rule extraction is not available')) {
      void reply.code(503).send({ error: 'CODEX_UNAVAILABLE', message });
      return;
    }
    if (message.includes('CODEX_ESPN_UNAVAILABLE')) {
      void reply.code(503).send({ error: 'CODEX_ESPN_UNAVAILABLE', message });
      return;
    }
    if (message === 'ACTION_RECOMMENDATION_NOT_ACTIVE') {
      void reply.code(404).send({ error: message });
      return;
    }
    if (message === 'ACTION_RECOMMENDATION_IS_ADVISORY') {
      void reply.code(422).send({ error: message });
      return;
    }
    if (message === 'ACTION_ESPN_SNAPSHOT_REQUIRED') {
      void reply.code(409).send({ error: message });
      return;
    }
    if (message === 'ESPN_AUTH_REQUIRED' || message === 'ESPN_BINDING_MISMATCH') {
      void reply.code(409).send({ error: message });
      return;
    }
    if (message === 'ESPN_OBSERVATION_TIME_INVALID') {
      void reply.code(422).send({ error: message });
      return;
    }
    if (message === 'FAN_DESK_DISABLED') {
      void reply.code(409).send({ error: message });
      return;
    }
    if (
      message.includes('requires an existing full rule set') ||
      message.includes('not valid base64') ||
      message.includes('exceeds 10 MB')
    ) {
      void reply.code(422).send({ error: 'RULE_IMPORT_REJECTED', message });
      return;
    }
    if (message.includes('UNIQUE constraint failed')) {
      void reply.code(409).send({ error: 'CONFLICT', message: 'That record already exists' });
      return;
    }
    app.log.error(error);
    void reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Local daemon request failed' });
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'ai-fantasy-football-daemon',
    version: '0.1.0',
  }));

  app.get('/api/bootstrap', async () => {
    const codexStatus = options.codexReadiness
      ? await options.codexReadiness().catch((error: unknown) => ({
          authenticated: false,
          accountKind: null,
          models: [],
          skills: [],
          computerUseAvailable: false,
          readyForDecisions: false,
          readyForEspn: false,
          issues: [error instanceof Error ? error.message : String(error)],
        }))
      : null;
    const codex = codexStatus
      ? {
          authenticated: codexStatus.authenticated,
          accountKind: codexStatus.accountKind,
          modelCount: codexStatus.models.length,
          skillCount: codexStatus.skills.length,
          defaultModel: codexStatus.models.find((model) => model.isDefault)?.model ?? null,
          computerUseAvailable: codexStatus.computerUseAvailable,
          readyForDecisions: codexStatus.readyForDecisions,
          readyForEspn: codexStatus.readyForEspn,
          issues: codexStatus.issues,
        }
      : null;
    return {
      teams: teams.list(),
      schedules: options.scheduler?.entries() ?? [],
      codex,
      data: {
        sleeper: snapshots.latest('sleeper'),
        nflverse: snapshots.latest('nflverse'),
        rss: snapshots.latest('rss'),
      },
    };
  });

  app.get('/api/teams', async () => teams.list());

  app.get('/api/players', async (request) => {
    const query = playerListQuerySchema.parse(request.query);
    return {
      reviews: playerIntelligence.listReviews({
        limit: query.limit,
        offset: query.offset,
        ...(query.position ? { position: query.position } : {}),
        ...(query.search ? { search: query.search } : {}),
      }),
      limit: query.limit,
      offset: query.offset,
    };
  });

  app.get('/api/players/:playerId', async (request, reply) => {
    const { playerId } = playerParamsSchema.parse(request.params);
    const review = playerIntelligence.getReview(playerId);
    return review ?? (await reply.code(404).send({ error: 'PLAYER_REVIEW_NOT_FOUND' }));
  });

  app.get('/api/player-intelligence/export', async (request, reply) => {
    const { format } = playerExportQuerySchema.parse(request.query);
    const reviews = playerIntelligence.listReviews({ limit: 5_000 });
    const generatedAt = reviews[0]?.generatedAt ?? now().toISOString();
    const manifest = {
      schemaVersion: 1,
      kind: 'ai-fantasy-football.player-intelligence-handoff',
      generatedAt,
      playerCount: reviews.length,
      methodology: {
        score: {
          historicalProduction: 0.55,
          recentOpportunity: 0.2,
          sleeperRosterMomentum: 0.15,
          attributedNewsBuzz: 0.1,
        },
        history: 'Three most recent completed NFL regular seasons, weighted 62/25/13 percent',
        warning:
          'Rankings are decision support, not facts. Buzz measures attention, not player quality.',
      },
    };
    reply.header(
      'content-disposition',
      `attachment; filename="player-intelligence-${generatedAt.slice(0, 10)}.${format}"`,
    );
    if (format === 'jsonl') {
      reply.type('application/x-ndjson');
      return (
        [
          JSON.stringify({ recordType: 'manifest', ...manifest }),
          ...reviews.map((review) => JSON.stringify({ recordType: 'player', ...review })),
        ].join('\n') + '\n'
      );
    }
    return { ...manifest, players: reviews };
  });

  app.post('/api/teams', async (request, reply) => {
    const input = createTeamSchema.parse(request.body);
    const team = teams.create(safeTeamInput(input, now().toISOString()));
    await options.scheduler?.start?.(false);
    return await reply.code(201).send(team);
  });

  app.get('/api/teams/:teamId', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const team = teams.getById(teamId);
    if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
    const strategy = team.strategyProfileId
      ? strategies.getForTeam(team.id, team.strategyProfileId)
      : null;
    const latestPortalSnapshot = portalSnapshots.latestForTeam(teamId);
    return {
      team,
      rules: ruleSets.listForTeam(teamId),
      strategy,
      espnSnapshot: latestPortalSnapshot ? portalSnapshotView(latestPortalSnapshot) : null,
      recommendations: recommendations.listActive(teamId, now().toISOString()),
      runs: runs.listRecent(teamId),
      fanDesk: options.fanDesk
        ? {
            profile: options.fanDesk.profile(team),
            posts: options.fanDesk.posts(teamId),
            emails: options.fanDesk.emails(teamId),
          }
        : null,
      fanNetwork: options.fanNetwork
        ? {
            network: options.fanNetwork.network(team),
            events: options.fanNetwork.events(teamId),
            runs: options.fanNetwork.runs(teamId),
          }
        : null,
    };
  });

  app.get('/api/teams/:teamId/fan-desk', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const team = teams.getById(teamId);
    if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
    if (!options.fanDesk) return await reply.code(503).send({ error: 'FAN_DESK_UNAVAILABLE' });
    return {
      profile: options.fanDesk.profile(team),
      posts: options.fanDesk.posts(teamId),
      emails: options.fanDesk.emails(teamId),
    };
  });

  app.put('/api/teams/:teamId/fan-desk', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const team = teams.getById(teamId);
    if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
    if (!options.fanDesk) return await reply.code(503).send({ error: 'FAN_DESK_UNAVAILABLE' });
    return options.fanDesk.saveProfile(team, fanDeskInputSchema.parse(request.body));
  });

  app.post('/api/teams/:teamId/fan-desk/generate', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const team = teams.getById(teamId);
    if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
    if (!options.fanDesk) return await reply.code(503).send({ error: 'FAN_DESK_UNAVAILABLE' });
    return await options.fanDesk.generate(team);
  });

  app.get('/api/teams/:teamId/fan-network', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const team = teams.getById(teamId);
    if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
    if (!options.fanNetwork)
      return await reply.code(503).send({ error: 'FAN_NETWORK_UNAVAILABLE' });
    return {
      network: options.fanNetwork.network(team),
      events: options.fanNetwork.events(teamId),
      runs: options.fanNetwork.runs(teamId),
    };
  });

  app.put('/api/teams/:teamId/fan-network', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const team = teams.getById(teamId);
    if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
    if (!options.fanNetwork)
      return await reply.code(503).send({ error: 'FAN_NETWORK_UNAVAILABLE' });
    return options.fanNetwork.saveNetwork(team, fanNetworkInputSchema.parse(request.body));
  });

  app.post('/api/teams/:teamId/fan-network/events', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const team = teams.getById(teamId);
    if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
    if (!options.fanNetwork)
      return await reply.code(503).send({ error: 'FAN_NETWORK_UNAVAILABLE' });
    const input = fanNetworkEventInputSchema.parse(request.body);
    const { correlationId, ...eventInput } = input;
    return await options.fanNetwork.dispatch({
      team,
      ...eventInput,
      ...(correlationId ? { correlationId } : {}),
    });
  });

  app.patch('/api/teams/:teamId', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const existing = teams.getById(teamId);
    if (!existing) return await reply.code(404).send({ error: 'NOT_FOUND' });
    const patch = updateTeamSchema.parse(request.body);
    const updated = { ...existing, updatedAt: now().toISOString() };
    if (patch.name !== undefined) updated.name = patch.name;
    if (patch.timeZone !== undefined) updated.timeZone = patch.timeZone;
    if (patch.color !== undefined) updated.color = patch.color;
    if (patch.espnLeagueId !== undefined) updated.espnLeagueId = patch.espnLeagueId;
    if (patch.espnTeamId !== undefined) updated.espnTeamId = patch.espnTeamId;
    const saved = teams.update(updated);
    await options.scheduler?.start?.(false);
    return saved;
  });

  app.put('/api/teams/:teamId/strategy', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const team = teams.getById(teamId);
    if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
    const input = strategyInputSchema.parse(request.body);
    const timestamp = now().toISOString();
    const existing = team.strategyProfileId
      ? strategies.getForTeam(teamId, team.strategyProfileId)
      : null;
    return strategies.save(
      strategyProfileV1Schema.parse({
        schemaVersion: 1,
        id: existing?.id ?? randomUUID(),
        teamId,
        ...input,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }),
    );
  });

  app.put('/api/teams/:teamId/automation', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const team = teams.getById(teamId);
    if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
    const { policy, confirmation } = automationInputSchema.parse(request.body);
    if (!team.automation.armed && policy.armed && confirmation !== 'ARM ESPN AUTOMATION') {
      return await reply.code(400).send({
        error: 'ARMING_CONFIRMATION_REQUIRED',
        message: 'Type ARM ESPN AUTOMATION to enable browser mutations',
      });
    }
    return teams.updateAutomation(teamId, policy, now().toISOString());
  });

  app.get('/api/teams/:teamId/rules', async (request) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    return ruleSets.listForTeam(teamId);
  });

  app.post('/api/teams/:teamId/rules/import', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const upload = uploadSchema.parse(request.body);
    const source: RuleSource = {
      name: upload.name,
      mimeType: upload.mimeType,
      bytes: decodeUpload(upload.contentBase64),
      observedAt: now().toISOString(),
    };
    const result = await ruleImports.import(teamId, source);
    return await reply.code(201).send(result);
  });

  app.post('/api/teams/:teamId/rules/:ruleSetId/activate', async (request) => {
    const { teamId, ruleSetId } = ruleParamsSchema.parse(request.params);
    return teams.activateRuleSet(teamId, ruleSetId, now().toISOString());
  });

  app.get('/api/teams/:teamId/recommendations', async (request) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    return recommendations.listActive(teamId, now().toISOString());
  });

  app.post(
    '/api/teams/:teamId/recommendations/:recommendationId/execute',
    async (request, reply) => {
      const { teamId, recommendationId } = recommendationParamsSchema.parse(request.params);
      executeRecommendationSchema.parse(request.body);
      const team = teams.getById(teamId);
      if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
      if (!options.espnActions) {
        return await reply.code(503).send({ error: 'CODEX_ESPN_UNAVAILABLE' });
      }
      return await options.espnActions.executeRecommendation(team, recommendationId);
    },
  );

  app.get('/api/teams/:teamId/espn/snapshot', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    if (!teams.getById(teamId)) return await reply.code(404).send({ error: 'NOT_FOUND' });
    const snapshot = portalSnapshots.latestForTeam(teamId);
    return snapshot ? portalSnapshotView(snapshot) : null;
  });

  app.post('/api/teams/:teamId/espn/sync', async (request, reply) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    const team = teams.getById(teamId);
    if (!team) return await reply.code(404).send({ error: 'NOT_FOUND' });
    if (!options.espnSnapshots) {
      return await reply.code(503).send({ error: 'CODEX_ESPN_UNAVAILABLE' });
    }
    return await options.espnSnapshots.sync(team);
  });

  app.get('/api/teams/:teamId/runs', async (request) => {
    const { teamId } = teamParamsSchema.parse(request.params);
    return runs.listRecent(teamId);
  });

  app.post('/api/teams/:teamId/jobs/:jobType/run', async (request, reply) => {
    const { teamId, jobType } = jobParamsSchema.parse(request.params) as {
      teamId: string;
      jobType: ManagementJobType;
    };
    if (!options.scheduler) {
      return await reply.code(503).send({ error: 'SCHEDULER_UNAVAILABLE' });
    }
    const run = await options.scheduler.trigger(teamId, jobType);
    return run ?? (await reply.code(409).send({ error: 'JOB_ALREADY_RUNNING' }));
  });

  return app;
}
