import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { NewsFeed } from '@ai-ff/data';
import {
  AutomationRunRepository,
  JobLeaseRepository,
  openDatabase,
  TeamRepository,
} from '@ai-ff/db';
import { defineManagementJobs, DurableJobRunner, LocalTeamScheduler } from '@ai-ff/scheduler';
import { z } from 'zod';

import { buildServer } from './app.js';
import { CodexClientManager } from './codex-manager.js';
import { CodexRuleExtractorService } from './codex-rule-extractor.js';
import { defaultNewsFeeds, ManagementJobs } from './management-jobs.js';
import type { CodexRuleExtractor } from './rule-import-service.js';

const host = process.env.AI_FF_HOST ?? '127.0.0.1';
const port = Number(process.env.AI_FF_PORT ?? 4318);
const workspaceRoot = resolve(process.env.AI_FF_WORKSPACE_ROOT ?? process.cwd());
const configuredPath = process.env.AI_FF_DB_PATH;
const databasePath =
  configuredPath === ':memory:' ? ':memory:' : resolve(configuredPath ?? join('var', 'app.sqlite'));

if (databasePath !== ':memory:') await mkdir(dirname(databasePath), { recursive: true });
const database = openDatabase(databasePath);
const teams = new TeamRepository(database.db);
const runs = new AutomationRunRepository(database.db);
const leases = new JobLeaseRepository(database.db);
const management = new ManagementJobs(database.db, { feeds: configuredNewsFeeds() });
const definitions = defineManagementJobs(management.handlers());
const runner = new DurableJobRunner(runs, leases);
const scheduler = new LocalTeamScheduler(teams, runner, definitions);
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

await scheduler.start(false);
const app = await buildServer({
  logger: true,
  database,
  scheduler,
  ruleExtractor,
  codexReadiness: async () => await codex.readiness(workspaceRoot),
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
