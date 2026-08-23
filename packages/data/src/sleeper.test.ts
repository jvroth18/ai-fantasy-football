import { describe, expect, it } from 'vitest';

import { SleeperProvider } from './sleeper.js';

const now = () => new Date('2026-08-23T12:00:00.000Z');

describe('Sleeper provider', () => {
  it('normalizes supported players and preserves cross-provider ids', async () => {
    const provider = new SleeperProvider(
      async () =>
        Response.json({
          '100': {
            player_id: '100',
            full_name: 'Example Runner',
            position: 'RB',
            team: 'NYJ',
            active: true,
            gsis_id: '00-0039999',
            espn_id: 123,
          },
          coach: { player_id: 'coach', full_name: 'Coach', position: 'HC', active: true },
        }),
      now,
    );

    const snapshot = await provider.fetchPlayers();

    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]).toMatchObject({
      fullName: 'Example Runner',
      position: 'RB',
      espnId: '123',
      gsisId: '00-0039999',
      mappingConfidence: 0.98,
    });
    expect(snapshot.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes public add trends into canonical player ids', async () => {
    const provider = new SleeperProvider(
      async () => Response.json([{ player_id: '100', count: 42 }]),
      now,
    );

    await expect(provider.fetchTrending('add', 24, 10)).resolves.toEqual([
      {
        playerId: 'f533781c-6e58-5a75-ba5c-16c3068ae671',
        type: 'add',
        count: 42,
        lookbackHours: 24,
      },
    ]);
  });
});
