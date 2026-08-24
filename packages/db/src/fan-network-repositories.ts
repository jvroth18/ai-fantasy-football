import { randomUUID } from 'node:crypto';

import {
  fanAgentRunV1Schema,
  fanNetworkEventV1Schema,
  fanNetworkV1Schema,
  type FanAgentRunV1,
  type FanNetworkEventV1,
  type FanNetworkV1,
} from '@ai-ff/domain';
import { and, desc, eq } from 'drizzle-orm';

import type { AppDatabase } from './database.js';
import { fanAgentRuns, fanNetworkEvents, fanNetworks } from './schema.js';

export class FanNetworkRepository {
  constructor(private readonly db: AppDatabase) {}

  saveNetwork(input: FanNetworkV1): FanNetworkV1 {
    const network = fanNetworkV1Schema.parse(input);
    const existing = this.db
      .select({ teamId: fanNetworks.teamId })
      .from(fanNetworks)
      .where(eq(fanNetworks.id, network.id))
      .get();
    if (existing && existing.teamId !== network.teamId)
      throw new Error('Fan network belongs to a different team');
    this.db
      .insert(fanNetworks)
      .values({
        id: network.id,
        teamId: network.teamId,
        networkJson: JSON.stringify(network),
        createdAt: network.createdAt,
        updatedAt: network.updatedAt,
      })
      .onConflictDoUpdate({
        target: fanNetworks.teamId,
        set: { networkJson: JSON.stringify(network), updatedAt: network.updatedAt },
      })
      .run();
    return network;
  }

  getNetwork(teamId: string): FanNetworkV1 | null {
    const row = this.db.select().from(fanNetworks).where(eq(fanNetworks.teamId, teamId)).get();
    return row ? fanNetworkV1Schema.parse(JSON.parse(row.networkJson)) : null;
  }

  saveEvent(input: FanNetworkEventV1): FanNetworkEventV1 {
    const event = fanNetworkEventV1Schema.parse(input);
    const network = this.db
      .select({ teamId: fanNetworks.teamId })
      .from(fanNetworks)
      .where(and(eq(fanNetworks.id, event.networkId), eq(fanNetworks.teamId, event.teamId)))
      .get();
    if (!network) throw new Error('Fan network event does not belong to team');
    this.db
      .insert(fanNetworkEvents)
      .values({
        id: event.id,
        teamId: event.teamId,
        networkId: event.networkId,
        type: event.type,
        correlationId: event.correlationId,
        eventJson: JSON.stringify(event),
        createdAt: event.createdAt,
      })
      .run();
    return event;
  }

  listEvents(teamId: string, limit = 50): FanNetworkEventV1[] {
    return this.db
      .select()
      .from(fanNetworkEvents)
      .where(eq(fanNetworkEvents.teamId, teamId))
      .orderBy(desc(fanNetworkEvents.createdAt))
      .limit(Math.min(limit, 200))
      .all()
      .map((row) => fanNetworkEventV1Schema.parse(JSON.parse(row.eventJson)));
  }

  saveRun(input: FanAgentRunV1): FanAgentRunV1 {
    const run = fanAgentRunV1Schema.parse(input);
    this.db
      .insert(fanAgentRuns)
      .values({
        id: run.id,
        teamId: run.teamId,
        networkId: run.networkId,
        eventId: run.eventId,
        agentId: run.agentId,
        status: run.status,
        runJson: JSON.stringify(run),
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      })
      .onConflictDoUpdate({
        target: [fanAgentRuns.eventId, fanAgentRuns.agentId],
        set: {
          status: run.status,
          runJson: JSON.stringify(run),
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        },
      })
      .run();
    return run;
  }

  getRun(eventId: string, agentId: string): FanAgentRunV1 | null {
    const row = this.db
      .select()
      .from(fanAgentRuns)
      .where(and(eq(fanAgentRuns.eventId, eventId), eq(fanAgentRuns.agentId, agentId)))
      .get();
    return row ? fanAgentRunV1Schema.parse(JSON.parse(row.runJson)) : null;
  }

  listRuns(teamId: string, limit = 50): FanAgentRunV1[] {
    return this.db
      .select()
      .from(fanAgentRuns)
      .where(eq(fanAgentRuns.teamId, teamId))
      .orderBy(desc(fanAgentRuns.createdAt))
      .limit(Math.min(limit, 200))
      .all()
      .map((row) => fanAgentRunV1Schema.parse(JSON.parse(row.runJson)));
  }

  nextRunId(): string {
    return randomUUID();
  }
}
