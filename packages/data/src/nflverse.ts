import { z } from 'zod';

import { parse } from 'csv-parse/sync';

import type {
  FetchLike,
  NflverseAsset,
  PlayerSeasonStats,
  ProviderMetadata,
  ProviderSnapshot,
} from './types.js';
import { digestJson } from './utils.js';

const githubAssetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string().url(),
  content_type: z.string(),
  size: z.number().int().nonnegative(),
  updated_at: z.string().datetime(),
});

const releaseSchema = z.object({ assets: z.array(githubAssetSchema) });

export const nflverseMetadata: ProviderMetadata = {
  id: 'nflverse',
  displayName: 'nflverse data releases',
  license: 'CC BY-SA 4.0 for 2023+ player stats; credit FTN Data via nflverse',
  termsUrl: 'https://github.com/nflverse/nflverse-data',
  minimumRefreshMinutes: 360,
};

export const supportedNflverseDatasets = [
  'players',
  'stats_player',
  'rosters',
  'injuries',
  'depth_charts',
  'snap_counts',
  'schedules',
  'combine',
  'draft_picks',
] as const;

export type NflverseDataset = (typeof supportedNflverseDatasets)[number];

export class NflverseProvider {
  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listAssets(dataset: NflverseDataset): Promise<ProviderSnapshot<NflverseAsset>> {
    const url = `https://api.github.com/repos/nflverse/nflverse-data/releases/tags/${dataset}`;
    const response = await this.fetcher(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'ai-fantasy-football/0.1',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok)
      throw new Error(`nflverse ${dataset} catalog failed with HTTP ${response.status}`);
    const release = releaseSchema.parse(await response.json());
    const records = release.assets.map((asset) => ({
      dataset,
      name: asset.name,
      url: asset.browser_download_url,
      contentType: asset.content_type,
      size: asset.size,
      updatedAt: asset.updated_at,
    }));
    return {
      provider: nflverseMetadata,
      fetchedAt: this.now().toISOString(),
      sourceUrl: url,
      digest: digestJson(release),
      records,
    };
  }

  async fetchPlayerSeasonStats(season: number): Promise<ProviderSnapshot<PlayerSeasonStats>> {
    const url = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${season}.csv`;
    const response = await this.fetcher(url, {
      headers: { accept: 'text/csv', 'user-agent': 'ai-fantasy-football/0.1' },
    });
    if (!response.ok)
      throw new Error(`nflverse player stats ${season} failed with HTTP ${response.status}`);
    const text = await response.text();
    const rows = parse(text, { columns: true, skip_empty_lines: true }) as Array<
      Record<string, string>
    >;
    const number = (value: string | undefined) => {
      const parsed = Number(value ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const records = rows
      .filter((row) => Boolean(row.player_id))
      .map((row) => ({
        gsisId: row.player_id!,
        season,
        games: number(row.games),
        fantasyPoints: number(row.fantasy_points),
        fantasyPointsPpr: number(row.fantasy_points_ppr),
        passingAttempts: number(row.attempts),
        carries: number(row.carries),
        targets: number(row.targets),
        receptions: number(row.receptions),
        touchdowns: number(row.passing_tds) + number(row.rushing_tds) + number(row.receiving_tds),
      }));
    return {
      provider: nflverseMetadata,
      fetchedAt: this.now().toISOString(),
      sourceUrl: url,
      digest: digestJson(records),
      records,
    };
  }

  selectAsset(
    assets: NflverseAsset[],
    options: { season?: number; format?: 'parquet' | 'csv' } = {},
  ): NflverseAsset | null {
    const format = options.format ?? 'parquet';
    const extension = `.${format}`;
    const season = options.season === undefined ? null : String(options.season);
    const candidates = assets.filter(
      (asset) => asset.name.endsWith(extension) && (!season || asset.name.includes(season)),
    );
    return candidates.sort((left, right) => left.name.localeCompare(right.name))[0] ?? null;
  }
}
