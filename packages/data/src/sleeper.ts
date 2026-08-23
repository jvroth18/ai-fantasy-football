import { playerIdentityV1Schema, type PlayerIdentityV1 } from '@ai-ff/domain';
import { z } from 'zod';

import type { FetchLike, PlayerCatalogSnapshot, ProviderMetadata, SleeperTrend } from './types.js';
import { digestJson, stableUuid } from './utils.js';

const sleeperPlayerSchema = z.object({
  player_id: z.string(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  full_name: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  active: z.boolean().optional(),
  gsis_id: z.string().nullable().optional(),
  espn_id: z.union([z.string(), z.number()]).nullable().optional(),
});

const sleeperPlayersSchema = z.record(z.string(), sleeperPlayerSchema);
const trendSchema = z.array(
  z.object({
    player_id: z.string(),
    count: z.number().int().nonnegative(),
  }),
);

export const sleeperMetadata: ProviderMetadata = {
  id: 'sleeper',
  displayName: 'Sleeper Public API',
  license: 'Free for non-commercial use; upstream terms apply',
  termsUrl: 'https://docs.sleeper.com/',
  minimumRefreshMinutes: 1_440,
};

const positions: Record<string, PlayerIdentityV1['position'] | undefined> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  DEF: 'DST',
  DL: 'DL',
  LB: 'LB',
  DB: 'DB',
  IDP: 'IDP',
};

export class SleeperProvider {
  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetchPlayers(activeOnly = true): Promise<PlayerCatalogSnapshot> {
    const url = `https://api.sleeper.app/v1/players/nfl${activeOnly ? '?active=true' : ''}`;
    const response = await this.fetcher(url, {
      headers: { accept: 'application/json', 'user-agent': 'ai-fantasy-football/0.1' },
    });
    if (!response.ok) throw new Error(`Sleeper players failed with HTTP ${response.status}`);
    const raw = sleeperPlayersSchema.parse(await response.json());
    const fetchedAt = this.now().toISOString();
    const records = Object.values(raw)
      .filter((player) => !activeOnly || player.active !== false)
      .map((player) => this.normalizePlayer(player, fetchedAt))
      .filter((player): player is PlayerIdentityV1 => player !== null);

    return {
      provider: sleeperMetadata,
      fetchedAt,
      sourceUrl: url,
      digest: digestJson(raw),
      records,
    };
  }

  async fetchTrending(
    type: SleeperTrend['type'],
    lookbackHours = 24,
    limit = 100,
  ): Promise<SleeperTrend[]> {
    const url = `https://api.sleeper.app/v1/players/nfl/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`;
    const response = await this.fetcher(url, {
      headers: { accept: 'application/json', 'user-agent': 'ai-fantasy-football/0.1' },
    });
    if (!response.ok) throw new Error(`Sleeper trends failed with HTTP ${response.status}`);
    return trendSchema.parse(await response.json()).map((trend) => ({
      playerId: stableUuid('sleeper-player', trend.player_id),
      type,
      count: trend.count,
      lookbackHours,
    }));
  }

  private normalizePlayer(
    player: z.infer<typeof sleeperPlayerSchema>,
    updatedAt: string,
  ): PlayerIdentityV1 | null {
    const position = player.position ? positions[player.position] : undefined;
    const name =
      player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(' ');
    if (!position || !name) return null;

    return playerIdentityV1Schema.parse({
      schemaVersion: 1,
      id: stableUuid('sleeper-player', player.player_id),
      fullName: name,
      position,
      nflTeam: player.team ?? null,
      espnId:
        player.espn_id === null || player.espn_id === undefined ? null : String(player.espn_id),
      sleeperId: player.player_id,
      gsisId: player.gsis_id ?? null,
      mappingConfidence: player.gsis_id || player.espn_id ? 0.98 : 0.8,
      manuallyVerified: false,
      updatedAt,
    });
  }
}
