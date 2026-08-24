import { randomUUID } from 'node:crypto';

import { openDatabase, TeamRepository, type DatabaseHandle } from '@ai-ff/db';
import type { TeamConfigV1 } from '@ai-ff/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FanNetworkService } from './fan-network-service.js';

const now = '2026-08-23T18:00:00.000Z';
const handles: DatabaseHandle[] = [];
const team = (): TeamConfigV1 => ({
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
  createdAt: now,
  updatedAt: now,
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

describe('fan network runtime', () => {
  it('walks a digest through scout, analyst, voices, moderation, and publication', async () => {
    const handle = openDatabase();
    handles.push(handle);
    const created = new TeamRepository(handle.db).create(team());
    const service = new FanNetworkService(handle.db, { now: () => new Date(now) });
    const result = await service.dispatch({
      team: created,
      type: 'digest.due',
      payload: { reason: 'scheduled' },
    });
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'digest.due',
        'league.signal.detected',
        'analysis.ready',
        'fan.post.drafted',
        'fan.post.approved',
        'fan.post.published',
      ]),
    );
    expect(result.runs.filter((run) => run.status === 'completed').length).toBeGreaterThanOrEqual(
      5,
    );
  });

  it('records adapter failures without losing the event trace', async () => {
    const handle = openDatabase();
    handles.push(handle);
    const created = new TeamRepository(handle.db).create(team());
    const executor = vi.fn(async ({ agent }: { agent: { id: string } }) => {
      if (agent.id === 'analyst') throw new Error('model offline');
      if (agent.id === 'scout') return [{ type: 'league.signal.detected' as const, payload: {} }];
      return [];
    });
    const service = new FanNetworkService(handle.db, { now: () => new Date(now), executor });
    const result = await service.dispatch({ team: created, type: 'digest.due', payload: {} });
    expect(
      result.runs.some(
        (run) => run.status === 'failed' && run.errorCode === 'AGENT_EXECUTION_FAILED',
      ),
    ).toBe(true);
    expect(service.events(created.id)).toHaveLength(2);
  });
});
