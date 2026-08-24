import { randomUUID } from 'node:crypto';

import {
  openDatabase,
  PortalSnapshotRepository,
  TeamRepository,
  type DatabaseHandle,
} from '@ai-ff/db';
import type { TeamConfigV1 } from '@ai-ff/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FanDeskService } from './fan-desk-service.js';

const now = '2026-08-23T18:00:00.000Z';
const handles: DatabaseHandle[] = [];

function team(): TeamConfigV1 {
  return {
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
  };
}

function snapshot(teamId: string) {
  return {
    id: randomUUID(),
    teamId,
    leagueId: 'league-1',
    platformTeamId: 'team-7',
    digest: 'a'.repeat(64),
    observedAt: now,
    capturedAt: now,
    snapshotJson: JSON.stringify({
      signedIn: true,
      leagueId: 'league-1',
      teamId: 'team-7',
      page: 'clubhouse',
      roster: [
        {
          playerId: 'p1',
          name: 'Starter Alpha',
          position: 'RB',
          nflTeam: 'BUF',
          availability: 'active',
          slot: 'RB',
          locked: false,
        },
      ],
      availablePlayers: [
        {
          playerId: 'p2',
          name: 'Breakout Beta',
          position: 'WR',
          nflTeam: 'SEA',
          availability: 'active',
          acquisitionType: 'waiver',
          rosteredPercent: 39,
        },
      ],
      leagueTeams: [
        { teamId: 'team-7', name: 'Fourth and Goal', roster: [] },
        { teamId: 'team-8', name: 'Rival FC', roster: [] },
        { teamId: 'team-9', name: 'Spreadsheet Kings', roster: [] },
      ],
      faabRemaining: 74,
      faabSpentThisWeek: 0,
      waiverClaims: [],
      tradeOffers: [],
      draft: { status: 'pre_draft', onClockTeamId: null, draftSlot: 7, picks: [] },
      observedAt: now,
    }),
  };
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

describe('fan desk service', () => {
  it('creates a default profile, publishes a post, and preserves the team boundary', async () => {
    const handle = openDatabase();
    handles.push(handle);
    const created = new TeamRepository(handle.db).create(team());
    new PortalSnapshotRepository(handle.db).record(snapshot(created.id));
    const service = new FanDeskService(handle.db, { now: () => new Date(now) });

    const result = await service.generate(created);

    expect(result.post.teamId).toBe(created.id);
    expect(result.post.evidence[0]?.sourceType).toBe('espn_scan');
    expect(service.posts(created.id)).toHaveLength(1);
    expect(service.posts(randomUUID())).toEqual([]);
  });

  it('queues an email and marks it sent only after the sender confirms delivery', async () => {
    const handle = openDatabase();
    handles.push(handle);
    const created = new TeamRepository(handle.db).create(team());
    const service = new FanDeskService(handle.db, {
      now: () => new Date(now),
      email: vi.fn(async () => ({ sent: true, provider: 'test-mail' })),
    });
    service.saveProfile(created, {
      name: 'Night Shift',
      voice: 'analyst',
      heat: 0.4,
      rumorTolerance: 0.2,
      cadence: 'daily',
      enabled: true,
      emailEnabled: true,
      emailAddress: 'fan@example.com',
      emailSubjectPrefix: 'F&G',
    });

    const result = await service.generate(created);

    expect(result.email).toMatchObject({
      status: 'sent',
      provider: 'test-mail',
      recipient: 'fan@example.com',
    });
    expect(result.post.status).toBe('emailed');
    expect(service.emails(created.id)).toHaveLength(1);
  });
});
