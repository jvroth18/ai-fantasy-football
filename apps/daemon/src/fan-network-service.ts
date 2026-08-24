import { randomUUID } from 'node:crypto';

import { FanNetworkRepository, type AppDatabase } from '@ai-ff/db';
import {
  type FanAgent,
  type FanEventType,
  type FanNetworkEventV1,
  type FanNetworkV1,
  type FanAgentRunV1,
  type SourceEvidence,
  type TeamConfigV1,
} from '@ai-ff/domain';
import {
  agentsForEvent,
  createNetworkEvent,
  createQueuedRun,
  defaultFanNetwork,
} from '@ai-ff/fan-network';

export type FanAgentOutput = {
  type: FanEventType;
  payload: Record<string, unknown>;
  evidence?: SourceEvidence[];
};

export type FanAgentExecutor = (input: {
  agent: FanAgent;
  event: FanNetworkEventV1;
  network: FanNetworkV1;
}) => Promise<FanAgentOutput[]>;

export type FanNetworkDispatchResult = {
  rootEvent: FanNetworkEventV1;
  events: FanNetworkEventV1[];
  runs: FanAgentRunV1[];
};

export type FanNetworkServiceOptions = {
  executor?: FanAgentExecutor;
  now?: () => Date;
};

function deterministicOutputs(agent: FanAgent, event: FanNetworkEventV1): FanAgentOutput[] {
  if (agent.role === 'observer') {
    return [
      { type: 'league.signal.detected', payload: { ...event.payload, observedBy: agent.id } },
    ];
  }
  if (agent.role === 'analyst') {
    return [
      {
        type: 'analysis.ready',
        payload: {
          ...event.payload,
          analysisBy: agent.id,
          analysis: 'Evidence is ready for a voice agent.',
        },
        evidence: event.evidence,
      },
    ];
  }
  if (agent.role === 'superfan' || agent.role === 'contrarian') {
    return [
      {
        type: event.type === 'fan.mention.received' ? 'fan.reply.drafted' : 'fan.post.drafted',
        payload: { ...event.payload, voice: agent.role, draftedBy: agent.id },
        evidence: event.evidence,
      },
    ];
  }
  if (agent.role === 'commissioner' || agent.role === 'moderator') {
    const type =
      event.type === 'fan.reply.drafted' || event.type === 'fan.mention.received'
        ? 'fan.reply.approved'
        : 'fan.post.approved';
    return [
      {
        type,
        payload: { ...event.payload, approvedBy: agent.id, aiLabel: 'AI-generated fan desk' },
        evidence: event.evidence,
      },
    ];
  }
  if (agent.role === 'publisher') {
    const type = event.type === 'fan.reply.approved' ? 'fan.reply.published' : 'fan.post.published';
    return [
      { type, payload: { ...event.payload, publishedBy: agent.id }, evidence: event.evidence },
    ];
  }
  return [];
}

export class FanNetworkService {
  readonly #repository: FanNetworkRepository;
  readonly #executor: FanAgentExecutor;
  readonly #now: () => Date;

  constructor(database: AppDatabase, options: FanNetworkServiceOptions = {}) {
    this.#repository = new FanNetworkRepository(database);
    this.#executor =
      options.executor ?? (async ({ agent, event }) => deterministicOutputs(agent, event));
    this.#now = options.now ?? (() => new Date());
  }

  network(team: TeamConfigV1): FanNetworkV1 {
    return (
      this.#repository.getNetwork(team.id) ??
      this.#repository.saveNetwork(defaultFanNetwork(team, this.#now().toISOString()))
    );
  }

  saveNetwork(
    team: TeamConfigV1,
    input: Omit<FanNetworkV1, 'schemaVersion' | 'id' | 'teamId' | 'createdAt' | 'updatedAt'>,
  ): FanNetworkV1 {
    const existing = this.#repository.getNetwork(team.id);
    const now = this.#now().toISOString();
    return this.#repository.saveNetwork({
      schemaVersion: 1,
      id: existing?.id ?? randomUUID(),
      teamId: team.id,
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  events(teamId: string): FanNetworkEventV1[] {
    return this.#repository.listEvents(teamId);
  }
  runs(teamId: string): FanAgentRunV1[] {
    return this.#repository.listRuns(teamId);
  }

  async dispatch(input: {
    team: TeamConfigV1;
    type: FanEventType;
    payload: Record<string, unknown>;
    evidence?: SourceEvidence[];
    correlationId?: string;
  }): Promise<FanNetworkDispatchResult> {
    const network = this.network(input.team);
    const rootEvent = this.#repository.saveEvent(
      createNetworkEvent({
        network,
        teamId: input.team.id,
        type: input.type,
        payload: input.payload,
        evidence: input.evidence ?? [],
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        now: this.#now().toISOString(),
      }),
    );
    const events: FanNetworkEventV1[] = [rootEvent];
    const runs: FanAgentRunV1[] = [];
    if (!network.enabled) return { rootEvent, events, runs };
    await this.#visit(network, rootEvent, events, runs, 0);
    return { rootEvent, events, runs };
  }

  async #visit(
    network: FanNetworkV1,
    event: FanNetworkEventV1,
    events: FanNetworkEventV1[],
    runs: FanAgentRunV1[],
    depth: number,
  ): Promise<void> {
    if (depth >= network.policies.maxTurnsPerEvent) return;
    for (const agent of agentsForEvent(network, event.type)) {
      const existing = this.#repository.getRun(event.id, agent.id);
      if (existing) {
        runs.push(existing);
        continue;
      }
      const now = this.#now().toISOString();
      const queued = createQueuedRun(event, agent, now);
      this.#repository.saveRun(queued);
      const executing = { ...queued, status: 'executing' as const, startedAt: now };
      this.#repository.saveRun(executing);
      try {
        const outputs = await this.#executor({ agent, event, network });
        const outputIds: string[] = [];
        for (const output of outputs) {
          const child = this.#repository.saveEvent(
            createNetworkEvent({
              network,
              teamId: event.teamId,
              type: output.type,
              payload: output.payload,
              evidence: output.evidence ?? event.evidence,
              sourceAgentId: agent.id,
              correlationId: event.correlationId,
              now: this.#now().toISOString(),
            }),
          );
          outputIds.push(child.id);
          events.push(child);
          await this.#visit(network, child, events, runs, depth + 1);
        }
        const completed = {
          ...executing,
          status: 'completed' as const,
          outputEventIds: outputIds,
          finishedAt: this.#now().toISOString(),
        };
        this.#repository.saveRun(completed);
        runs.push(completed);
      } catch (error) {
        const failed = {
          ...executing,
          status: 'failed' as const,
          errorCode: 'AGENT_EXECUTION_FAILED',
          errorMessage:
            error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          finishedAt: this.#now().toISOString(),
        };
        this.#repository.saveRun(failed);
        runs.push(failed);
      }
    }
  }
}
