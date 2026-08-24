import { randomUUID } from 'node:crypto';

import type { TeamConfigV1 } from '@ai-ff/domain';
import { describe, expect, it } from 'vitest';

import { agentsForEvent, createNetworkEvent, createQueuedRun, defaultFanNetwork } from './index.js';

const team: TeamConfigV1 = {
  schemaVersion: 1,
  id: randomUUID(),
  name: 'Fourth and Goal',
  platform: 'espn',
  season: 2026,
  timeZone: 'America/New_York',
  color: '#b9f55b',
  espnLeagueId: 'league-1',
  espnTeamId: 'team-7',
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
  createdAt: '2026-08-23T18:00:00.000Z',
  updatedAt: '2026-08-23T18:00:00.000Z',
};

describe('fan network topology', () => {
  it('ships a valid, editable league media room graph', () => {
    const network = defaultFanNetwork(team, '2026-08-23T18:00:00.000Z');
    expect(network.agents.map((agent) => agent.id)).toEqual([
      'scout',
      'analyst',
      'superfan',
      'contrarian',
      'commissioner',
      'publisher',
    ]);
    expect(agentsForEvent(network, 'analysis.ready').map((agent) => agent.id)).toEqual([
      'superfan',
      'contrarian',
    ]);
    expect(agentsForEvent(network, 'fan.mention.received').map((agent) => agent.id)).toEqual([
      'commissioner',
    ]);
  });

  it('creates correlated events and idempotent-ready runs', () => {
    const network = defaultFanNetwork(team, '2026-08-23T18:00:00.000Z');
    const event = createNetworkEvent({
      network,
      teamId: team.id,
      type: 'digest.due',
      payload: { reason: 'scheduled' },
      now: '2026-08-23T18:00:00.000Z',
    });
    const agent = agentsForEvent(network, event.type)[0];
    expect(agent).toBeDefined();
    const run = createQueuedRun(event, agent!, '2026-08-23T18:00:00.000Z');
    expect(run).toMatchObject({
      eventId: event.id,
      agentId: 'scout',
      status: 'queued',
      attempt: 1,
    });
  });
});
