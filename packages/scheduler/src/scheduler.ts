import type { TeamRepository } from '@ai-ff/db';
import { Cron } from 'croner';

import type { DurableJobRunner } from './runner.js';
import type { JobDefinition, SchedulerEntry } from './types.js';

export class LocalTeamScheduler {
  readonly #jobs: Array<{ cron: Cron; entry: Omit<SchedulerEntry, 'nextRun'> }> = [];

  constructor(
    readonly teams: TeamRepository,
    readonly runner: DurableJobRunner,
    readonly definitions: JobDefinition[],
  ) {}

  async start(runCatchUps = true): Promise<void> {
    this.stop();
    const teams = this.teams.list();
    for (const team of teams) {
      for (const definition of this.definitions) {
        const cron = new Cron(
          definition.cron,
          { timezone: team.timeZone, protect: true },
          async () => {
            await this.runner.run(team, definition);
          },
        );
        this.#jobs.push({
          cron,
          entry: {
            teamId: team.id,
            teamName: team.name,
            timeZone: team.timeZone,
            jobType: definition.jobType,
            cron: definition.cron,
          },
        });
      }
    }
    if (runCatchUps) await this.runner.runDueCatchUps(teams, this.definitions);
  }

  entries(): SchedulerEntry[] {
    return this.#jobs.map(({ cron, entry }) => ({
      ...entry,
      nextRun: cron.nextRun()?.toISOString() ?? null,
    }));
  }

  stop(): void {
    for (const job of this.#jobs) job.cron.stop();
    this.#jobs.splice(0);
  }
}
