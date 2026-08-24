import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import type { CodexReadiness } from '@ai-ff/codex';
import {
  AutomationRunRepository,
  DataSnapshotRepository,
  openDatabase,
  RecommendationRepository,
  RuleSetRepository,
  StrategyRepository,
  TeamRepository,
  type DatabaseHandle,
} from '@ai-ff/db';
import { automationPolicySchema, strategyProfileV1Schema, type TeamConfigV1 } from '@ai-ff/domain';
import { supportedRuleMimeTypes, type RuleSource } from '@ai-ff/rules';
import type { LocalTeamScheduler, ManagementJobType } from '@ai-ff/scheduler';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';

import { RuleImportService, type CodexRuleExtractor } from './rule-import-service.js';

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
  ]),
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

export type ServerOptions = {
  logger?: boolean;
  database?: DatabaseHandle;
  scheduler?: Pick<LocalTeamScheduler, 'entries' | 'trigger'> &
    Partial<Pick<LocalTeamScheduler, 'start'>>;
  ruleExtractor?: CodexRuleExtractor | null;
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
    return {
      team,
      rules: ruleSets.listForTeam(teamId),
      strategy,
      recommendations: recommendations.listActive(teamId, now().toISOString()),
      runs: runs.listRecent(teamId),
    };
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
