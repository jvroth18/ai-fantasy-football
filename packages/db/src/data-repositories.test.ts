import { randomUUID } from 'node:crypto';

import type { PlayerIdentityV1 } from '@ai-ff/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type DatabaseHandle } from './database.js';
import {
  DataSnapshotRepository,
  PlayerRepository,
  PortalSnapshotRepository,
} from './data-repositories.js';
import { TeamRepository } from './repositories.js';

const team = {
  schemaVersion: 1 as const,
  id: 'd27ad1c7-5691-4ffd-809f-f46c128f59ac',
  name: 'Snapshot Team',
  platform: 'espn' as const,
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
    incomingTradeAccepts: false as const,
    maxFaabPerClaim: null,
    maxFaabPerWeek: null,
    minimumFaabReserve: 0,
    maximumDraftReach: 24,
    minimumDataFreshnessMinutes: 180,
  },
  createdAt: '2026-08-23T12:00:00.000Z',
  updatedAt: '2026-08-23T12:00:00.000Z',
};

const databases: DatabaseHandle[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('normalized data persistence', () => {
  it('upserts canonical players and resolves ESPN ids', () => {
    const handle = openDatabase();
    databases.push(handle);
    const players = new PlayerRepository(handle.db);
    const player: PlayerIdentityV1 = {
      schemaVersion: 1,
      id: randomUUID(),
      fullName: 'Example Runner',
      position: 'RB',
      nflTeam: 'NYJ',
      espnId: '123',
      sleeperId: '100',
      gsisId: '00-0039999',
      mappingConfidence: 0.98,
      manuallyVerified: false,
      updatedAt: '2026-08-23T12:00:00.000Z',
    };

    expect(players.upsertMany([player])).toBe(1);
    expect(players.getByEspnId('123')).toEqual(player);
  });

  it('returns the latest provider snapshot', () => {
    const handle = openDatabase();
    databases.push(handle);
    const snapshots = new DataSnapshotRepository(handle.db);
    snapshots.record({
      id: randomUUID(),
      provider: 'sleeper',
      sourceUrl: 'https://api.sleeper.app/v1/players/nfl',
      digest: 'a'.repeat(64),
      recordCount: 10,
      status: 'success',
      fetchedAt: '2026-08-22T12:00:00.000Z',
      metadataJson: '{}',
    });
    snapshots.record({
      id: randomUUID(),
      provider: 'sleeper',
      sourceUrl: 'https://api.sleeper.app/v1/players/nfl',
      digest: 'b'.repeat(64),
      recordCount: 12,
      status: 'success',
      fetchedAt: '2026-08-23T12:00:00.000Z',
      metadataJson: '{}',
    });

    expect(snapshots.latest('sleeper')).toMatchObject({ recordCount: 12 });
  });

  it('keeps portal observations scoped to one local team', () => {
    const handle = openDatabase();
    databases.push(handle);
    new TeamRepository(handle.db).create(team);
    const snapshots = new PortalSnapshotRepository(handle.db);
    const older = snapshots.record({
      id: randomUUID(),
      teamId: team.id,
      leagueId: team.espnLeagueId,
      platformTeamId: team.espnTeamId,
      digest: 'a'.repeat(64),
      snapshotJson: '{"version":1}',
      observedAt: '2026-08-23T12:00:00.000Z',
      capturedAt: '2026-08-23T12:00:01.000Z',
    });
    const newer = snapshots.record({
      id: randomUUID(),
      teamId: team.id,
      leagueId: team.espnLeagueId,
      platformTeamId: team.espnTeamId,
      digest: 'b'.repeat(64),
      snapshotJson: '{"version":2}',
      observedAt: '2026-08-23T13:00:00.000Z',
      capturedAt: '2026-08-23T13:00:01.000Z',
    });

    expect(snapshots.latestForTeam(team.id)).toEqual(newer);
    expect(snapshots.listRecentForTeam(team.id)).toEqual([newer, older]);
  });
});
