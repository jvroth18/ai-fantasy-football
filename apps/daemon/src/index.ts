import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { NewsFeed } from '@ai-ff/data';
import {
  AutomationRunRepository,
  JobLeaseRepository,
  openDatabase,
  PortalSnapshotRepository,
  TeamRepository,
} from '@ai-ff/db';
import type { TeamConfigV1 } from '@ai-ff/domain';
import { z } from 'zod';
import { CodexEspnPortalAdapter } from '@ai-ff/espn';
import { defineManagementJobs, DurableJobRunner, LocalTeamScheduler } from '@ai-ff/scheduler';

import { buildServer } from './app.js';
import { CodexClientManager } from './codex-manager.js';
import { CodexPlayerValueService, type PlayerValueProvider } from './codex-player-values.js';
import { CodexRuleExtractorService } from './codex-rule-extractor.js';
import { EspnActionService } from './espn-action-service.js';
import { defaultNewsFeeds, ManagementJobs } from './management-jobs.js';
import type { CodexRuleExtractor } from './rule-import-service.js';
import { EspnSnapshotService } from './espn-snapshot-service.js';
import { TeamDecisionOrchestrator } from './team-decision-orchestrator.js';
import { FanDeskService, resendEmailSender } from './fan-desk-service.js';
import { FanNetworkService } from './fan-network-service.js';
import type { FanVoiceWriter } from '@ai-ff/fan-desk';

const host = process.env.AI_FF_HOST ?? '127.0.0.1';
const port = Number(process.env.AI_FF_PORT ?? 4318);
const workspaceRoot = resolve(process.env.AI_FF_WORKSPACE_ROOT ?? process.cwd());
const webRoot = process.env.AI_FF_WEB_ROOT ? resolve(process.env.AI_FF_WEB_ROOT) : null;
const configuredPath = process.env.AI_FF_DB_PATH;
const databasePath =
  configuredPath === ':memory:' ? ':memory:' : resolve(configuredPath ?? join('var', 'app.sqlite'));

if (databasePath !== ':memory:') await mkdir(dirname(databasePath), { recursive: true });
const database = openDatabase(databasePath);
const teams = new TeamRepository(database.db);
const runs = new AutomationRunRepository(database.db);
const leases = new JobLeaseRepository(database.db);
const codex = new CodexClientManager();
const uploadRoot = join(workspaceRoot, 'var', 'rule-uploads');
const ruleExtractor: CodexRuleExtractor = {
  extract: async (source, team) =>
    await new CodexRuleExtractorService(
      await codex.client(workspaceRoot),
      workspaceRoot,
      uploadRoot,
    ).extract(source, team),
};
async function syncEspnSnapshot(team: TeamConfigV1) {
  const client = await codex.client(workspaceRoot);
  const readiness = await client.readiness(workspaceRoot);
  if (!readiness.readyForEspn) {
    throw new Error(`CODEX_ESPN_UNAVAILABLE: ${readiness.issues.join('; ')}`);
  }
  const thread = await client.startDecisionThread({
    cwd: workspaceRoot,
    ephemeral: true,
    baseInstructions: [
      'Observe the authenticated ESPN Fantasy Football portal through visible Computer Use only.',
      'Never call private or undocumented ESPN endpoints.',
      'Never submit, save, draft, claim, drop, trade, or otherwise mutate ESPN state.',
      'Never expose credentials, cookies, tokens, personal account details, or screenshots in output.',
    ].join('\n'),
  });
  return await new EspnSnapshotService(
    new PortalSnapshotRepository(database.db),
    new CodexEspnPortalAdapter(client, thread.threadId),
  ).sync(team);
}
const playerValues: PlayerValueProvider = {
  valuePlayers: async (request) =>
    await new CodexPlayerValueService(
      await codex.client(workspaceRoot),
      workspaceRoot,
    ).valuePlayers(request),
};
const decisions = new TeamDecisionOrchestrator(database.db, playerValues, {
  syncPortal: syncEspnSnapshot,
});
const fanVoiceWriter: FanVoiceWriter = async ({ profile, team, seed, context }) => {
  const client = await codex.client(workspaceRoot);
  const readiness = await client.readiness(workspaceRoot);
  if (!readiness.readyForDecisions)
    throw new Error(`CODEX_FAN_WRITER_UNAVAILABLE: ${readiness.issues.join('; ')}`);
  const thread = await client.startDecisionThread({
    cwd: workspaceRoot,
    ephemeral: true,
    baseInstructions: [
      'You are a passionate fantasy football fan desk editor.',
      'Use only the supplied evidence. The ESPN Computer Use snapshot is observational, not permission to mutate anything.',
      'Write vivid, funny, occasionally contrarian copy without harassment, invented injuries, fabricated trades, or unsupported certainty.',
      'Keep the post under 900 words and preserve the distinction between observed fact and opinion.',
    ].join('\\n'),
  });
  return await client.runStructuredTurn({
    threadId: thread.threadId,
    prompt: JSON.stringify({
      profile,
      team: { name: team.name, season: team.season },
      seed,
      evidence: context.latest,
      news: context.news.slice(0, 5),
    }),
    outputSchema: {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        dek: { type: 'string' },
        body: { type: 'string' },
        stance: { type: 'string' },
      },
      required: ['headline', 'dek', 'body', 'stance'],
      additionalProperties: false,
    },
    parse: (value) =>
      z
        .object({
          headline: z.string().min(1).max(180),
          dek: z.string().min(1).max(240),
          body: z.string().min(1).max(12_000),
          stance: z.string().min(1).max(240),
        })
        .parse(value),
    effort: 'low',
    timeoutMs: 120_000,
  });
};
const fanNetwork = new FanNetworkService(database.db);
const fanDesk = new FanDeskService(database.db, {
  writer: fanVoiceWriter,
  networkDispatch: async (input) => await fanNetwork.dispatch(input),
  email: resendEmailSender(),
});
const management = new ManagementJobs(database.db, {
  feeds: configuredNewsFeeds(),
  analyzeTeam: async (team, jobType) => await decisions.analyze(team, jobType),
  fanDigest: async (team) => await fanDesk.runScheduled(team),
});
const definitions = defineManagementJobs(management.handlers());
const runner = new DurableJobRunner(runs, leases);
const scheduler = new LocalTeamScheduler(teams, runner, definitions);
const espnSnapshots = { sync: syncEspnSnapshot };
const espnActions = new EspnActionService(database.db, async (team) => {
  const client = await codex.client(workspaceRoot);
  const readiness = await client.readiness(workspaceRoot);
  if (!readiness.readyForEspn) {
    throw new Error(`CODEX_ESPN_UNAVAILABLE: ${readiness.issues.join('; ')}`);
  }
  const thread = await client.startDecisionThread({
    cwd: workspaceRoot,
    ephemeral: true,
    baseInstructions: [
      'Operate the authenticated ESPN Fantasy Football portal through visible Computer Use only.',
      `The only permitted account scope is league ${team.espnLeagueId}, team ${team.espnTeamId}.`,
      'Observe freely, but mutate only when the application supplies one exact policy-approved action.',
      'Make no more than one submission attempt and never retry an ambiguous result.',
      'Never accept an incoming trade, call private endpoints, bypass login or MFA, or expose credentials, cookies, tokens, personal details, or screenshots.',
    ].join('\n'),
  });
  return new CodexEspnPortalAdapter(client, thread.threadId);
});

await scheduler.start(false);
const app = await buildServer({
  logger: true,
  database,
  scheduler,
  ruleExtractor,
  espnSnapshots,
  espnActions,
  fanDesk,
  fanNetwork,
  codexReadiness: async () => await codex.readiness(workspaceRoot),
  webRoot,
});
await app.listen({ host, port });

void runner.runDueCatchUps(teams.list(), definitions).catch((error: unknown) => {
  app.log.error(error, 'Management catch-up failed');
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Stopping local daemon');
  scheduler.stop();
  await app.close();
  await codex.close();
  database.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

function configuredNewsFeeds(): NewsFeed[] {
  const value = process.env.AI_FF_NEWS_FEEDS_JSON;
  if (!value) return defaultNewsFeeds;
  return z
    .array(z.object({ name: z.string().min(1), url: z.string().url() }))
    .parse(JSON.parse(value));
}
