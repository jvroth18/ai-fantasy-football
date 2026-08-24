import { randomUUID } from 'node:crypto';

import {
  fanNetworkEventV1Schema,
  fanNetworkV1Schema,
  type FanAgent,
  type FanAgentRunV1,
  type FanEventType,
  type FanNetworkEventV1,
  type FanNetworkV1,
  type SourceEvidence,
  type TeamConfigV1,
} from '@ai-ff/domain';

export const defaultFanNetwork = (team: TeamConfigV1, now: string): FanNetworkV1 => {
  const id = randomUUID();
  return fanNetworkV1Schema.parse({
    schemaVersion: 1,
    id,
    teamId: team.id,
    name: `${team.name} League Media Room`,
    enabled: true,
    agents: [
      {
        id: 'scout',
        name: 'League Scout',
        role: 'observer',
        instructions: 'Summarize only visible league and news signals. Never infer hidden state.',
        model: { provider: 'none', modelId: 'deterministic', temperature: 0, maxOutputTokens: 512 },
        listensTo: ['espn.snapshot.updated', 'news.item.created', 'digest.due'],
        emits: ['league.signal.detected'],
        enabled: true,
        heat: 0.2,
        toolPermissions: { readPortal: true, readNews: true, publish: false, reply: false },
      },
      {
        id: 'analyst',
        name: 'Film Room Analyst',
        role: 'analyst',
        instructions: 'Turn signals into a concise, evidence-linked football interpretation.',
        model: { provider: 'codex', modelId: 'default', temperature: 0.35, maxOutputTokens: 900 },
        listensTo: ['league.signal.detected'],
        emits: ['analysis.ready'],
        enabled: true,
        heat: 0.45,
        toolPermissions: { readPortal: true, readNews: true, publish: false, reply: false },
      },
      {
        id: 'superfan',
        name: 'The Superfan',
        role: 'superfan',
        instructions: 'Write passionate, funny copy while preserving the evidence boundary.',
        model: { provider: 'codex', modelId: 'default', temperature: 0.8, maxOutputTokens: 900 },
        listensTo: ['analysis.ready'],
        emits: ['fan.post.drafted', 'fan.reply.drafted'],
        enabled: true,
        heat: 0.7,
        toolPermissions: { readPortal: false, readNews: false, publish: false, reply: false },
      },
      {
        id: 'contrarian',
        name: 'The Contrarian',
        role: 'contrarian',
        instructions:
          'Challenge the group-chat consensus without inventing facts or targeting people.',
        model: {
          provider: 'ollama',
          modelId: 'llama3.1:8b',
          temperature: 0.9,
          maxOutputTokens: 900,
        },
        listensTo: ['analysis.ready'],
        emits: ['fan.post.drafted'],
        enabled: true,
        heat: 0.9,
        toolPermissions: { readPortal: false, readNews: false, publish: false, reply: false },
      },
      {
        id: 'commissioner',
        name: 'The Commissioner',
        role: 'commissioner',
        instructions:
          'Moderate drafts and replies. Reject unsupported claims and personal attacks.',
        model: { provider: 'codex', modelId: 'default', temperature: 0.2, maxOutputTokens: 700 },
        listensTo: ['fan.post.drafted', 'fan.reply.drafted', 'fan.mention.received'],
        emits: ['fan.post.approved', 'fan.reply.approved'],
        enabled: true,
        heat: 0.35,
        toolPermissions: { readPortal: true, readNews: true, publish: false, reply: false },
      },
      {
        id: 'publisher',
        name: 'Press Box Publisher',
        role: 'publisher',
        instructions: 'Publish only approved output to explicitly enabled channels.',
        model: { provider: 'none', modelId: 'deterministic', temperature: 0, maxOutputTokens: 256 },
        listensTo: ['fan.post.approved', 'fan.reply.approved'],
        emits: ['fan.post.published'],
        enabled: true,
        heat: 0,
        toolPermissions: { readPortal: false, readNews: false, publish: true, reply: true },
      },
    ],
    routes: [
      { event: 'digest.due', to: ['scout'], parallel: false },
      { event: 'espn.snapshot.updated', to: ['scout'], parallel: false },
      { event: 'news.item.created', to: ['scout'], parallel: false },
      { event: 'league.signal.detected', to: ['analyst'], parallel: false },
      { event: 'analysis.ready', to: ['superfan', 'contrarian'], parallel: true },
      { event: 'fan.post.drafted', to: ['commissioner'], parallel: true },
      { event: 'fan.reply.drafted', to: ['commissioner'], parallel: true },
      { event: 'fan.mention.received', to: ['commissioner'], parallel: false },
      { event: 'fan.post.approved', to: ['publisher'], parallel: false },
      { event: 'fan.reply.approved', to: ['publisher'], parallel: false },
    ],
    policies: {
      requireEvidence: true,
      identifyAsAi: true,
      maxRepliesPerHour: 20,
      maxModelSpendPerDay: 2,
      maxTurnsPerEvent: 8,
      neverInventInjuries: true,
      neverAcceptTrades: true,
    },
    createdAt: now,
    updatedAt: now,
  });
};

export function agentsForEvent(network: FanNetworkV1, event: FanEventType): FanAgent[] {
  const routed = new Set(
    network.routes.filter((route) => route.event === event).flatMap((route) => route.to),
  );
  return network.agents.filter(
    (agent) => agent.enabled && routed.has(agent.id) && agent.listensTo.includes(event),
  );
}

export function createNetworkEvent(input: {
  network: FanNetworkV1;
  teamId: string;
  type: FanEventType;
  payload: Record<string, unknown>;
  evidence?: SourceEvidence[];
  sourceAgentId?: string | null;
  correlationId?: string;
  now: string;
}): FanNetworkEventV1 {
  return fanNetworkEventV1Schema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    networkId: input.network.id,
    teamId: input.teamId,
    type: input.type,
    correlationId: input.correlationId ?? randomUUID(),
    sourceAgentId: input.sourceAgentId ?? null,
    payload: input.payload,
    evidence: input.evidence ?? [],
    createdAt: input.now,
  });
}

export function createQueuedRun(
  event: FanNetworkEventV1,
  agent: FanAgent,
  now: string,
): FanAgentRunV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    networkId: event.networkId,
    teamId: event.teamId,
    eventId: event.id,
    agentId: agent.id,
    status: 'queued',
    attempt: 1,
    outputEventIds: [],
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
}
