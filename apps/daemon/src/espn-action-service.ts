import { createHash, randomUUID } from 'node:crypto';

import {
  ActionExecutionRepository,
  ActionIntentRepository,
  PortalSnapshotRepository,
  RecommendationRepository,
  type AppDatabase,
} from '@ai-ff/db';
import {
  actionIntentV1Schema,
  type ActionIntentV1,
  type RecommendationV1,
  type TeamConfigV1,
} from '@ai-ff/domain';
import {
  EspnActionExecutor,
  type ActionExecutionResult,
  type ActionLedger,
  type EspnPortalAdapter,
  type PortalAction,
  type PortalActionResult,
  type PortalBinding,
} from '@ai-ff/espn';

import { EspnSnapshotService, portalSnapshotView } from './espn-snapshot-service.js';

export type EspnActionAdapterFactory = (team: TeamConfigV1) => Promise<EspnPortalAdapter>;

export type EspnActionServiceOptions = {
  now?: () => Date;
};

class DatabaseActionLedger implements ActionLedger {
  readonly #executions: ActionExecutionRepository;

  constructor(database: AppDatabase) {
    this.#executions = new ActionExecutionRepository(database);
  }

  get(teamId: string, idempotencyKey: string): ActionExecutionResult | undefined {
    return this.#executions.get<ActionExecutionResult>(teamId, idempotencyKey)?.result;
  }

  put(teamId: string, idempotencyKey: string, result: ActionExecutionResult): void {
    const existing = this.#executions.get<ActionExecutionResult>(teamId, idempotencyKey);
    this.#executions.put({
      id: existing?.id ?? randomUUID(),
      teamId,
      actionIntentId: result.intent.id,
      idempotencyKey,
      outcome: result.outcome,
      result,
      createdAt: existing?.createdAt ?? result.intent.updatedAt,
      updatedAt: result.intent.updatedAt,
    });
  }
}

class SnapshotRecordingAdapter implements EspnPortalAdapter {
  constructor(
    readonly delegate: EspnPortalAdapter,
    readonly team: TeamConfigV1,
    readonly snapshots: EspnSnapshotService,
  ) {}

  async observe(binding: PortalBinding) {
    const snapshot = await this.delegate.observe(binding);
    this.snapshots.record(this.team, snapshot);
    return snapshot;
  }

  async perform(binding: PortalBinding, action: PortalAction): Promise<PortalActionResult> {
    return await this.delegate.perform(binding, action);
  }
}

function idempotencyKey(
  teamId: string,
  recommendationId: string,
  action: NonNullable<RecommendationV1['action']>,
): string {
  return createHash('sha256')
    .update(`${teamId}:${recommendationId}:${JSON.stringify(action)}`)
    .digest('hex');
}

export class EspnActionService {
  readonly #recommendations: RecommendationRepository;
  readonly #intents: ActionIntentRepository;
  readonly #portalSnapshots: PortalSnapshotRepository;
  readonly #ledger: DatabaseActionLedger;
  readonly #now: () => Date;

  constructor(
    readonly database: AppDatabase,
    readonly adapterFactory: EspnActionAdapterFactory,
    options: EspnActionServiceOptions = {},
  ) {
    this.#recommendations = new RecommendationRepository(database);
    this.#intents = new ActionIntentRepository(database);
    this.#portalSnapshots = new PortalSnapshotRepository(database);
    this.#ledger = new DatabaseActionLedger(database);
    this.#now = options.now ?? (() => new Date());
  }

  async executeRecommendation(
    team: TeamConfigV1,
    recommendationId: string,
  ): Promise<ActionExecutionResult> {
    const now = this.#now().toISOString();
    const recommendation = this.#recommendations.getActiveForTeam(team.id, recommendationId, now);
    if (!recommendation) throw new Error('ACTION_RECOMMENDATION_NOT_ACTIVE');
    if (!recommendation.action) throw new Error('ACTION_RECOMMENDATION_IS_ADVISORY');
    const storedSnapshot = this.#portalSnapshots.latestForTeam(team.id);
    if (!storedSnapshot) throw new Error('ACTION_ESPN_SNAPSHOT_REQUIRED');
    const snapshot = portalSnapshotView(storedSnapshot);
    const key = idempotencyKey(team.id, recommendation.id, recommendation.action);
    const existing = this.#intents.getByIdempotencyKey(team.id, key);
    const intent: ActionIntentV1 =
      existing ??
      this.#intents.save(
        actionIntentV1Schema.parse({
          schemaVersion: 1,
          id: randomUUID(),
          teamId: team.id,
          recommendationId: recommendation.id,
          type: recommendation.action.type,
          payload: recommendation.action.payload,
          idempotencyKey: key,
          status: 'proposed',
          createdAt: now,
          updatedAt: now,
        }),
      );

    const delegate = await this.adapterFactory(team);
    const adapter = new SnapshotRecordingAdapter(
      delegate,
      team,
      new EspnSnapshotService(this.#portalSnapshots, delegate, this.#now),
    );
    const result = await new EspnActionExecutor(adapter, this.#ledger).execute({
      team,
      intent,
      dataObservedAt: snapshot.observedAt,
      now,
      ...(snapshot.snapshot.faabRemaining === null
        ? {}
        : { faabRemaining: snapshot.snapshot.faabRemaining }),
      ...(snapshot.snapshot.faabSpentThisWeek === null
        ? {}
        : { faabSpentThisWeek: snapshot.snapshot.faabSpentThisWeek }),
    });
    this.#intents.save(result.intent);
    return result;
  }
}
