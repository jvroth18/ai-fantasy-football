import { randomUUID } from 'node:crypto';

import type { PlayerIdentityV1 } from '@ai-ff/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type DatabaseHandle } from './database.js';
import { DataSnapshotRepository, PlayerRepository } from './data-repositories.js';

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
});
