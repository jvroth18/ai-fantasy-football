import { describe, expect, it } from 'vitest';

import { NflverseProvider } from './nflverse.js';

describe('nflverse release catalog', () => {
  it('normalizes assets and selects a season-specific parquet file', async () => {
    const provider = new NflverseProvider(
      async () =>
        Response.json({
          assets: [
            {
              name: 'roster_2025.parquet',
              browser_download_url:
                'https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2025.parquet',
              content_type: 'application/octet-stream',
              size: 100,
              updated_at: '2026-08-23T11:00:00.000Z',
            },
            {
              name: 'roster_2026.parquet',
              browser_download_url:
                'https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2026.parquet',
              content_type: 'application/octet-stream',
              size: 120,
              updated_at: '2026-08-23T12:00:00.000Z',
            },
          ],
        }),
      () => new Date('2026-08-23T12:00:00.000Z'),
    );

    const snapshot = await provider.listAssets('rosters');

    expect(provider.selectAsset(snapshot.records, { season: 2026 })).toMatchObject({
      name: 'roster_2026.parquet',
      size: 120,
    });
  });
});
