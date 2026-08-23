import { randomUUID } from 'node:crypto';

import type { AutomationRunRepository, JobLeaseRepository } from '@ai-ff/db';
import type { AutomationRunV1, TeamConfigV1 } from '@ai-ff/domain';

import type { JobDefinition, RunResult } from './types.js';

export type JobRunnerOptions = {
  now?: () => Date;
  ownerId?: string;
};

export class DurableJobRunner {
  readonly #now: () => Date;
  readonly #ownerId: string;

  constructor(
    readonly runs: AutomationRunRepository,
    readonly leases: JobLeaseRepository,
    options: JobRunnerOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#ownerId = options.ownerId ?? randomUUID();
  }

  async run(
    team: TeamConfigV1,
    definition: JobDefinition,
    options: { scheduledFor?: string; catchUp?: boolean } = {},
  ): Promise<RunResult> {
    const startedAt = this.#now();
    const acquiredAt = startedAt.toISOString();
    const expiresAt = new Date(
      startedAt.getTime() + definition.leaseMinutes * 60_000,
    ).toISOString();
    if (!this.leases.acquire(team.id, definition.jobType, this.#ownerId, acquiredAt, expiresAt)) {
      return null;
    }

    const runId = randomUUID();
    const scheduledFor = options.scheduledFor ?? acquiredAt;
    const queued: AutomationRunV1 = {
      schemaVersion: 1,
      id: runId,
      teamId: team.id,
      jobType: definition.jobType,
      actionIntentId: null,
      status: 'queued',
      attempt: 1,
      errorCode: null,
      errorMessage: null,
      scheduledFor,
      startedAt: null,
      finishedAt: null,
    };
    this.runs.save(queued);
    this.runs.save({ ...queued, status: 'executing', startedAt: acquiredAt });

    try {
      const result = await definition.handler({
        team,
        runId,
        scheduledFor,
        catchUp: options.catchUp ?? false,
      });
      const finished: AutomationRunV1 = {
        ...queued,
        status: result.status,
        startedAt: acquiredAt,
        finishedAt: this.#now().toISOString(),
        errorCode: result.errorCode ?? null,
        errorMessage: result.message ?? null,
      };
      this.runs.save(finished);
      return finished;
    } catch (error) {
      const failed: AutomationRunV1 = {
        ...queued,
        status: 'failed',
        startedAt: acquiredAt,
        finishedAt: this.#now().toISOString(),
        errorCode: 'JOB_HANDLER_FAILED',
        errorMessage:
          error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      };
      this.runs.save(failed);
      return failed;
    } finally {
      this.leases.release(team.id, definition.jobType, this.#ownerId);
    }
  }

  async runDueCatchUps(teams: TeamConfigV1[], definitions: JobDefinition[]): Promise<RunResult[]> {
    const now = this.#now();
    const results: RunResult[] = [];
    for (const team of teams) {
      for (const definition of definitions) {
        if (definition.catchUpAfterMinutes === null) continue;
        const previous = this.runs.lastSuccessful(team.id, definition.jobType);
        const previousAt = previous?.finishedAt ?? previous?.scheduledFor;
        const elapsedMinutes = previousAt
          ? (now.getTime() - Date.parse(previousAt)) / 60_000
          : Number.POSITIVE_INFINITY;
        if (elapsedMinutes < definition.catchUpAfterMinutes) continue;
        results.push(
          await this.run(team, definition, { scheduledFor: now.toISOString(), catchUp: true }),
        );
      }
    }
    return results;
  }
}
