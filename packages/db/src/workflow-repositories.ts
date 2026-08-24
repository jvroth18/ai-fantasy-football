import {
  actionIntentV1Schema,
  automationRunV1Schema,
  recommendationV1Schema,
  strategyProfileV1Schema,
  type ActionIntentV1,
  type AutomationRunV1,
  type RecommendationV1,
  type StrategyProfileV1,
} from '@ai-ff/domain';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import type { AppDatabase } from './database.js';
import {
  actionExecutionResults,
  actionIntents,
  automationRuns,
  codexThreads,
  jobLeases,
  recommendations,
  strategyProfiles,
  teams,
} from './schema.js';

export type StoredActionExecution<T = unknown> = {
  id: string;
  teamId: string;
  actionIntentId: string;
  idempotencyKey: string;
  outcome: string;
  result: T;
  createdAt: string;
  updatedAt: string;
};

export type StoredCodexThread = {
  id: string;
  teamId: string;
  purpose: string;
  codexThreadId: string;
  updatedAt: string;
};

export class StrategyRepository {
  constructor(private readonly db: AppDatabase) {}

  save(input: StrategyProfileV1): StrategyProfileV1 {
    const profile = strategyProfileV1Schema.parse(input);
    const existing = this.db
      .select({ teamId: strategyProfiles.teamId })
      .from(strategyProfiles)
      .where(eq(strategyProfiles.id, profile.id))
      .get();
    if (existing && existing.teamId !== profile.teamId) {
      throw new Error('Strategy profile belongs to a different team');
    }
    this.db.transaction((transaction) => {
      transaction
        .insert(strategyProfiles)
        .values({
          id: profile.id,
          teamId: profile.teamId,
          profileJson: JSON.stringify(profile),
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        })
        .onConflictDoUpdate({
          target: strategyProfiles.id,
          set: { profileJson: JSON.stringify(profile), updatedAt: profile.updatedAt },
        })
        .run();
      transaction
        .update(teams)
        .set({ strategyProfileId: profile.id, updatedAt: profile.updatedAt })
        .where(eq(teams.id, profile.teamId))
        .run();
    });
    return profile;
  }

  getForTeam(teamId: string, profileId: string): StrategyProfileV1 | null {
    const row = this.db
      .select()
      .from(strategyProfiles)
      .where(and(eq(strategyProfiles.teamId, teamId), eq(strategyProfiles.id, profileId)))
      .get();
    return row ? strategyProfileV1Schema.parse(JSON.parse(row.profileJson)) : null;
  }
}

export class RecommendationRepository {
  constructor(private readonly db: AppDatabase) {}

  save(input: RecommendationV1): RecommendationV1 {
    const recommendation = recommendationV1Schema.parse(input);
    const existing = this.db
      .select({ teamId: recommendations.teamId })
      .from(recommendations)
      .where(eq(recommendations.id, recommendation.id))
      .get();
    if (existing && existing.teamId !== recommendation.teamId) {
      throw new Error('Recommendation belongs to a different team');
    }
    this.db
      .insert(recommendations)
      .values({
        id: recommendation.id,
        teamId: recommendation.teamId,
        type: recommendation.type,
        recommendationJson: JSON.stringify(recommendation),
        createdAt: recommendation.createdAt,
        expiresAt: recommendation.expiresAt,
      })
      .onConflictDoUpdate({
        target: recommendations.id,
        set: {
          recommendationJson: JSON.stringify(recommendation),
          expiresAt: recommendation.expiresAt,
        },
      })
      .run();
    return recommendation;
  }

  listActive(teamId: string, now: string): RecommendationV1[] {
    return this.db
      .select()
      .from(recommendations)
      .where(and(eq(recommendations.teamId, teamId), gt(recommendations.expiresAt, now)))
      .orderBy(desc(recommendations.createdAt))
      .all()
      .map((row) => recommendationV1Schema.parse(JSON.parse(row.recommendationJson)));
  }

  replaceActiveForTypes(
    teamId: string,
    types: RecommendationV1['type'][],
    inputs: RecommendationV1[],
    now: string,
  ): RecommendationV1[] {
    const uniqueTypes = [...new Set(types)];
    if (uniqueTypes.length === 0) throw new Error('At least one recommendation type is required');
    const parsed = inputs.map((input) => recommendationV1Schema.parse(input));
    for (const recommendation of parsed) {
      if (recommendation.teamId !== teamId) {
        throw new Error('Recommendation belongs to a different team');
      }
      if (!uniqueTypes.includes(recommendation.type)) {
        throw new Error('Replacement recommendation has an unexpected type');
      }
      const existing = this.db
        .select({ teamId: recommendations.teamId })
        .from(recommendations)
        .where(eq(recommendations.id, recommendation.id))
        .get();
      if (existing && existing.teamId !== teamId) {
        throw new Error('Recommendation belongs to a different team');
      }
    }

    this.db.transaction((transaction) => {
      transaction
        .update(recommendations)
        .set({ expiresAt: now })
        .where(
          and(
            eq(recommendations.teamId, teamId),
            gt(recommendations.expiresAt, now),
            inArray(recommendations.type, uniqueTypes),
          ),
        )
        .run();
      for (const recommendation of parsed) {
        transaction
          .insert(recommendations)
          .values({
            id: recommendation.id,
            teamId: recommendation.teamId,
            type: recommendation.type,
            recommendationJson: JSON.stringify(recommendation),
            createdAt: recommendation.createdAt,
            expiresAt: recommendation.expiresAt,
          })
          .onConflictDoUpdate({
            target: recommendations.id,
            set: {
              recommendationJson: JSON.stringify(recommendation),
              expiresAt: recommendation.expiresAt,
            },
          })
          .run();
      }
    });
    return parsed;
  }
}

export class ActionIntentRepository {
  constructor(private readonly db: AppDatabase) {}

  save(input: ActionIntentV1): ActionIntentV1 {
    const intent = actionIntentV1Schema.parse(input);
    const existing = this.db
      .select({ id: actionIntents.id })
      .from(actionIntents)
      .where(
        and(
          eq(actionIntents.teamId, intent.teamId),
          eq(actionIntents.idempotencyKey, intent.idempotencyKey),
        ),
      )
      .get();
    if (existing && existing.id !== intent.id) {
      throw new Error('Idempotency key already belongs to another action intent');
    }
    this.db
      .insert(actionIntents)
      .values({
        id: intent.id,
        teamId: intent.teamId,
        idempotencyKey: intent.idempotencyKey,
        status: intent.status,
        actionJson: JSON.stringify(intent),
        createdAt: intent.createdAt,
        updatedAt: intent.updatedAt,
      })
      .onConflictDoUpdate({
        target: [actionIntents.teamId, actionIntents.idempotencyKey],
        set: {
          status: intent.status,
          actionJson: JSON.stringify(intent),
          updatedAt: intent.updatedAt,
        },
      })
      .run();
    return intent;
  }

  getByIdempotencyKey(teamId: string, idempotencyKey: string): ActionIntentV1 | null {
    const row = this.db
      .select()
      .from(actionIntents)
      .where(
        and(eq(actionIntents.teamId, teamId), eq(actionIntents.idempotencyKey, idempotencyKey)),
      )
      .get();
    return row ? actionIntentV1Schema.parse(JSON.parse(row.actionJson)) : null;
  }
}

export class ActionExecutionRepository {
  constructor(private readonly db: AppDatabase) {}

  put<T>(input: StoredActionExecution<T>): void {
    const existing = this.db
      .select({
        id: actionExecutionResults.id,
        actionIntentId: actionExecutionResults.actionIntentId,
      })
      .from(actionExecutionResults)
      .where(
        and(
          eq(actionExecutionResults.teamId, input.teamId),
          eq(actionExecutionResults.idempotencyKey, input.idempotencyKey),
        ),
      )
      .get();
    if (
      existing &&
      (existing.id !== input.id || existing.actionIntentId !== input.actionIntentId)
    ) {
      throw new Error('Idempotency key already belongs to another action execution');
    }
    this.db
      .insert(actionExecutionResults)
      .values({
        id: input.id,
        teamId: input.teamId,
        actionIntentId: input.actionIntentId,
        idempotencyKey: input.idempotencyKey,
        outcome: input.outcome,
        resultJson: JSON.stringify(input.result),
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      })
      .onConflictDoUpdate({
        target: [actionExecutionResults.teamId, actionExecutionResults.idempotencyKey],
        set: {
          outcome: input.outcome,
          resultJson: JSON.stringify(input.result),
          updatedAt: input.updatedAt,
        },
      })
      .run();
  }

  get<T>(teamId: string, idempotencyKey: string): StoredActionExecution<T> | null {
    const row = this.db
      .select()
      .from(actionExecutionResults)
      .where(
        and(
          eq(actionExecutionResults.teamId, teamId),
          eq(actionExecutionResults.idempotencyKey, idempotencyKey),
        ),
      )
      .get();
    return row
      ? {
          id: row.id,
          teamId: row.teamId,
          actionIntentId: row.actionIntentId,
          idempotencyKey: row.idempotencyKey,
          outcome: row.outcome,
          result: JSON.parse(row.resultJson) as T,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
      : null;
  }
}

export class AutomationRunRepository {
  constructor(private readonly db: AppDatabase) {}

  save(input: AutomationRunV1): AutomationRunV1 {
    const run = automationRunV1Schema.parse(input);
    const existing = this.db
      .select({ teamId: automationRuns.teamId })
      .from(automationRuns)
      .where(eq(automationRuns.id, run.id))
      .get();
    if (existing && existing.teamId !== run.teamId) {
      throw new Error('Automation run belongs to a different team');
    }
    this.db
      .insert(automationRuns)
      .values({
        id: run.id,
        teamId: run.teamId,
        jobType: run.jobType,
        status: run.status,
        runJson: JSON.stringify(run),
        scheduledFor: run.scheduledFor,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        errorCode: run.errorCode,
      })
      .onConflictDoUpdate({
        target: automationRuns.id,
        set: {
          status: run.status,
          runJson: JSON.stringify(run),
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          errorCode: run.errorCode,
        },
      })
      .run();
    return run;
  }

  listRecent(teamId: string, limit = 50): AutomationRunV1[] {
    return this.db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.teamId, teamId))
      .orderBy(desc(automationRuns.scheduledFor))
      .limit(limit)
      .all()
      .map((row) => automationRunV1Schema.parse(JSON.parse(row.runJson)));
  }

  lastSuccessful(teamId: string, jobType: string): AutomationRunV1 | null {
    const row = this.db
      .select()
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.teamId, teamId),
          eq(automationRuns.jobType, jobType),
          eq(automationRuns.status, 'verified'),
        ),
      )
      .orderBy(desc(automationRuns.finishedAt))
      .limit(1)
      .get();
    return row ? automationRunV1Schema.parse(JSON.parse(row.runJson)) : null;
  }
}

export class CodexThreadRepository {
  constructor(private readonly db: AppDatabase) {}

  upsert(input: StoredCodexThread): StoredCodexThread {
    const existing = this.get(input.teamId, input.purpose);
    const stored = existing ? { ...input, id: existing.id } : input;
    this.db
      .insert(codexThreads)
      .values(stored)
      .onConflictDoUpdate({
        target: [codexThreads.teamId, codexThreads.purpose],
        set: { codexThreadId: input.codexThreadId, updatedAt: input.updatedAt },
      })
      .run();
    return stored;
  }

  get(teamId: string, purpose: string): StoredCodexThread | null {
    return (
      this.db
        .select()
        .from(codexThreads)
        .where(and(eq(codexThreads.teamId, teamId), eq(codexThreads.purpose, purpose)))
        .get() ?? null
    );
  }
}

export class JobLeaseRepository {
  constructor(private readonly db: AppDatabase) {}

  acquire(
    teamId: string,
    jobType: string,
    ownerId: string,
    acquiredAt: string,
    expiresAt: string,
  ): boolean {
    const result = this.db
      .insert(jobLeases)
      .values({ teamId, jobType, ownerId, acquiredAt, expiresAt })
      .onConflictDoUpdate({
        target: [jobLeases.teamId, jobLeases.jobType],
        set: { ownerId, acquiredAt, expiresAt },
        setWhere: sql`${jobLeases.expiresAt} <= ${acquiredAt}`,
      })
      .run();
    return result.changes === 1;
  }

  release(teamId: string, jobType: string, ownerId: string): boolean {
    const result = this.db
      .delete(jobLeases)
      .where(
        and(
          eq(jobLeases.teamId, teamId),
          eq(jobLeases.jobType, jobType),
          eq(jobLeases.ownerId, ownerId),
        ),
      )
      .run();
    return result.changes === 1;
  }
}
