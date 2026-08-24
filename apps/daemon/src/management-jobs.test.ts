import { randomUUID } from 'node:crypto';

import type { NflverseProvider, RssNewsProvider, SleeperProvider } from '@ai-ff/data';
import {
  DataSnapshotRepository,
  NewsRepository,
  openDatabase,
  PlayerRepository,
  TeamRepository,
  type DatabaseHandle,
} from '@ai-ff/db';
import type { TeamConfigV1 } from '@ai-ff/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManagementJobs } from './management-jobs.js';

const now = '2026-08-23T18:00:00.000Z';
const handles: DatabaseHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

function teamFixture(): TeamConfigV1 {
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

describe('management job handlers', () => {
  it('refreshes free player catalogs and trends once per freshness window', async () => {
    const handle = openDatabase();
    handles.push(handle);
    const fetchPlayers = vi.fn(async () => ({
      provider: {
        id: 'sleeper',
        displayName: 'Sleeper',
        license: 'test',
        termsUrl: 'https://docs.sleeper.com',
        minimumRefreshMinutes: 1_440,
      },
      fetchedAt: now,
      sourceUrl: 'https://api.sleeper.app/v1/players/nfl',
      digest: 'a'.repeat(64),
      records: [
        {
          schemaVersion: 1 as const,
          id: randomUUID(),
          fullName: 'Example Runner',
          position: 'RB' as const,
          nflTeam: 'BUF',
          espnId: '1',
          sleeperId: '1',
          gsisId: '00-1',
          mappingConfidence: 0.99,
          manuallyVerified: false,
          updatedAt: now,
        },
      ],
    }));
    const fetchTrending = vi.fn(async (type: 'add' | 'drop') => [
      { playerId: randomUUID(), type, count: 20, lookbackHours: 24 },
    ]);
    const listAssets = vi.fn(async (dataset: string) => ({
      provider: {
        id: 'nflverse',
        displayName: 'nflverse',
        license: 'test',
        termsUrl: 'https://github.com/nflverse/nflverse-data',
        minimumRefreshMinutes: 360,
      },
      fetchedAt: now,
      sourceUrl: `https://example.com/${dataset}`,
      digest: dataset.padEnd(64, '0'),
      records: [
        {
          dataset,
          name: `${dataset}.parquet`,
          url: `https://example.com/${dataset}.parquet`,
          contentType: 'application/octet-stream',
          size: 100,
          updatedAt: now,
        },
      ],
    }));
    const jobs = new ManagementJobs(handle.db, {
      sleeper: { fetchPlayers, fetchTrending } as unknown as SleeperProvider,
      nflverse: { listAssets } as unknown as NflverseProvider,
      feeds: [],
      now: () => new Date(now),
    });

    const first = await jobs.refreshData();
    const second = await jobs.refreshData();

    expect(first.status).toBe('verified');
    expect(second.message).toContain('cache still fresh');
    expect(fetchPlayers).toHaveBeenCalledOnce();
    expect(fetchTrending).toHaveBeenCalledTimes(2);
    expect(listAssets).toHaveBeenCalledTimes(9);
    expect(new PlayerRepository(handle.db).list()).toHaveLength(1);
    expect(new DataSnapshotRepository(handle.db).latest('nflverse')?.recordCount).toBe(9);
  });

  it('stores attributed RSS metadata and skips a fresh hourly refresh', async () => {
    const handle = openDatabase();
    handles.push(handle);
    const fetchFeed = vi.fn(async (feed: { name: string; url: string }) => ({
      provider: {
        id: 'rss',
        displayName: 'RSS',
        license: 'publisher terms',
        termsUrl: 'https://example.com/terms',
        minimumRefreshMinutes: 30,
      },
      fetchedAt: now,
      sourceUrl: feed.url,
      digest: 'b'.repeat(64),
      records: [
        {
          id: randomUUID(),
          title: 'Example Runner named starter',
          summary: 'The role is expanding.',
          source: feed.name,
          url: 'https://example.com/story',
          publishedAt: now,
          fetchedAt: now,
          playerIds: [],
        },
      ],
    }));
    const jobs = new ManagementJobs(handle.db, {
      news: { fetchFeed } as unknown as RssNewsProvider,
      feeds: [{ name: 'Official Feed', url: 'https://example.com/rss' }],
      now: () => new Date(now),
    });

    expect((await jobs.refreshNews()).status).toBe('verified');
    expect((await jobs.refreshNews()).message).toBe('News cache still fresh');
    expect(fetchFeed).toHaveBeenCalledOnce();
    expect(new NewsRepository(handle.db).listRecent()).toHaveLength(1);
  });

  it('surfaces missing setup as attention instead of inventing a recommendation', async () => {
    const handle = openDatabase();
    handles.push(handle);
    const teams = new TeamRepository(handle.db);
    const team = teams.create(teamFixture());
    const jobs = new ManagementJobs(handle.db, { feeds: [], now: () => new Date(now) });

    await expect(jobs.analyze(team, 'daily_manager')).resolves.toMatchObject({
      status: 'needs_attention',
      errorCode: 'ACTIVE_RULES_REQUIRED',
    });
  });
});
