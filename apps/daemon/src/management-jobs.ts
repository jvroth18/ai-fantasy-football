import { createHash, randomUUID } from 'node:crypto';

import type { NewsFeed, NewsItem, SleeperTrend } from '@ai-ff/data';
import {
  compilePlayerReviews,
  NflverseProvider,
  RssNewsProvider,
  SleeperProvider,
  supportedNflverseDatasets,
} from '@ai-ff/data';
import {
  DataSnapshotRepository,
  NewsRepository,
  PlayerIntelligenceRepository,
  PlayerRepository,
  RuleSetRepository,
  StrategyRepository,
  type AppDatabase,
} from '@ai-ff/db';
import type { TeamConfigV1 } from '@ai-ff/domain';
import type { JobHandler, JobHandlerResult, ManagementJobType } from '@ai-ff/scheduler';

export const defaultNewsFeeds: NewsFeed[] = [
  { name: 'ESPN NFL Headlines', url: 'https://www.espn.com/espn/rss/nfl/news' },
];

type SleeperSource = Pick<SleeperProvider, 'fetchPlayers' | 'fetchTrending'>;
type NflverseSource = Pick<NflverseProvider, 'listAssets' | 'fetchPlayerSeasonStats'>;
type NewsSource = Pick<RssNewsProvider, 'fetchFeed'>;

export type TeamAnalysis = (
  team: TeamConfigV1,
  jobType: Exclude<ManagementJobType, 'data_refresh' | 'news_refresh'>,
) => Promise<JobHandlerResult>;

export type ManagementJobOptions = {
  sleeper?: SleeperSource;
  nflverse?: NflverseSource;
  news?: NewsSource;
  feeds?: NewsFeed[];
  analyzeTeam?: TeamAnalysis;
  now?: () => Date;
};

function isFresh(fetchedAt: string | undefined, now: Date, minimumMinutes: number): boolean {
  if (!fetchedAt) return false;
  const age = now.getTime() - Date.parse(fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < minimumMinutes * 60_000;
}

function combinedDigest(values: string[]): string {
  return createHash('sha256').update(values.sort().join(':')).digest('hex');
}

export class ManagementJobs {
  readonly #players: PlayerRepository;
  readonly #snapshots: DataSnapshotRepository;
  readonly #newsItems: NewsRepository;
  readonly #intelligence: PlayerIntelligenceRepository;
  readonly #rules: RuleSetRepository;
  readonly #strategies: StrategyRepository;
  readonly #sleeper: SleeperSource;
  readonly #nflverse: NflverseSource;
  readonly #news: NewsSource;
  readonly #feeds: NewsFeed[];
  readonly #analyzeTeam: TeamAnalysis | null;
  readonly #now: () => Date;

  constructor(database: AppDatabase, options: ManagementJobOptions = {}) {
    this.#players = new PlayerRepository(database);
    this.#snapshots = new DataSnapshotRepository(database);
    this.#newsItems = new NewsRepository(database);
    this.#intelligence = new PlayerIntelligenceRepository(database);
    this.#rules = new RuleSetRepository(database);
    this.#strategies = new StrategyRepository(database);
    this.#sleeper = options.sleeper ?? new SleeperProvider();
    this.#nflverse = options.nflverse ?? new NflverseProvider();
    this.#news = options.news ?? new RssNewsProvider();
    this.#feeds = options.feeds ?? defaultNewsFeeds;
    this.#analyzeTeam = options.analyzeTeam ?? null;
    this.#now = options.now ?? (() => new Date());
  }

  handlers(): Record<ManagementJobType, JobHandler> {
    return {
      data_refresh: async () => await this.refreshData(),
      news_refresh: async () => await this.refreshNews(),
      daily_manager: async ({ team }) => await this.analyze(team, 'daily_manager'),
      waiver_plan: async ({ team }) => await this.analyze(team, 'waiver_plan'),
      trade_market: async ({ team }) => await this.analyze(team, 'trade_market'),
      lineup_watch: async ({ team }) => await this.analyze(team, 'lineup_watch'),
    };
  }

  async refreshData(): Promise<JobHandlerResult> {
    const now = this.#now();
    const sleeperLatest = this.#snapshots.latest('sleeper');
    const nflverseLatest = this.#snapshots.latest('nflverse');
    const messages: string[] = [];

    if (!isFresh(sleeperLatest?.fetchedAt, now, 1_440)) {
      const [catalog, adds, drops] = await Promise.all([
        this.#sleeper.fetchPlayers(true),
        this.#sleeper.fetchTrending('add', 24, 100),
        this.#sleeper.fetchTrending('drop', 24, 100),
      ]);
      this.#players.upsertMany(catalog.records);
      this.#snapshots.record({
        id: randomUUID(),
        provider: 'sleeper',
        sourceUrl: catalog.sourceUrl,
        digest: catalog.digest,
        recordCount: catalog.records.length + adds.length + drops.length,
        status: 'complete',
        fetchedAt: catalog.fetchedAt,
        metadataJson: JSON.stringify({ players: catalog.records.length, adds, drops }),
      });
      messages.push(`${catalog.records.length} Sleeper players`);
    } else {
      messages.push('Sleeper cache still fresh');
    }

    if (!isFresh(nflverseLatest?.fetchedAt, now, 360)) {
      const catalogs = await Promise.all(
        supportedNflverseDatasets.map(async (dataset) => await this.#nflverse.listAssets(dataset)),
      );
      const assets = catalogs.flatMap((catalog) => catalog.records);
      this.#snapshots.record({
        id: randomUUID(),
        provider: 'nflverse',
        sourceUrl: 'https://github.com/nflverse/nflverse-data/releases',
        digest: combinedDigest(catalogs.map((catalog) => catalog.digest)),
        recordCount: assets.length,
        status: 'cataloged',
        fetchedAt: now.toISOString(),
        metadataJson: JSON.stringify({
          datasets: Object.fromEntries(
            catalogs.map((catalog) => [catalog.records[0]?.dataset ?? 'unknown', catalog.records]),
          ),
        }),
      });
      messages.push(`${assets.length} nflverse assets cataloged`);

      const completedSeason = now.getUTCFullYear() - 1;
      const history = await Promise.all(
        [completedSeason, completedSeason - 1, completedSeason - 2].map(
          async (season) => await this.#nflverse.fetchPlayerSeasonStats(season),
        ),
      );
      for (const snapshot of history) {
        this.#intelligence.upsertSeasonStats(snapshot.records, snapshot.fetchedAt);
      }
      messages.push(
        `${history.reduce((sum, snapshot) => sum + snapshot.records.length, 0)} player-season rows`,
      );
    } else {
      messages.push('nflverse catalog still fresh');
    }

    const reviewCount = this.rebuildReviews(now);
    messages.push(`${reviewCount} player reviews ranked`);
    return { status: 'verified', message: messages.join('; ') };
  }

  async refreshNews(): Promise<JobHandlerResult> {
    const now = this.#now();
    const latest = this.#snapshots.latest('rss');
    if (isFresh(latest?.fetchedAt, now, 30)) {
      return { status: 'verified', message: 'News cache still fresh' };
    }
    if (this.#feeds.length === 0) {
      return {
        status: 'needs_attention',
        errorCode: 'NEWS_FEEDS_REQUIRED',
        message: 'No RSS feeds configured',
      };
    }

    const snapshots = await Promise.all(
      this.#feeds.map(async (feed) => await this.#news.fetchFeed(feed)),
    );
    const records = snapshots.flatMap((snapshot) => snapshot.records);
    for (const item of records) {
      this.#newsItems.upsert({
        id: item.id,
        title: item.title,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
        newsJson: JSON.stringify(item),
        fetchedAt: item.fetchedAt,
      });
    }
    this.#snapshots.record({
      id: randomUUID(),
      provider: 'rss',
      sourceUrl: this.#feeds.map((feed) => feed.url).join(','),
      digest: combinedDigest(snapshots.map((snapshot) => snapshot.digest)),
      recordCount: records.length,
      status: 'complete',
      fetchedAt: now.toISOString(),
      metadataJson: JSON.stringify({ feeds: this.#feeds, itemIds: records.map((item) => item.id) }),
    });
    const reviewCount = this.rebuildReviews(now);
    return {
      status: 'verified',
      message: `${records.length} news items refreshed; ${reviewCount} player reviews updated`,
    };
  }

  private rebuildReviews(now: Date): number {
    const sleeper = this.#snapshots.latest('sleeper');
    const metadata = sleeper
      ? (JSON.parse(sleeper.metadataJson) as { adds?: SleeperTrend[]; drops?: SleeperTrend[] })
      : {};
    const news = this.#newsItems.listRecent(500).map((row) => JSON.parse(row.newsJson) as NewsItem);
    const reviews = compilePlayerReviews({
      players: this.#players.list(),
      stats: this.#intelligence.listSeasonStats(),
      trends: [...(metadata.adds ?? []), ...(metadata.drops ?? [])],
      news,
      now,
    });
    return this.#intelligence.replaceReviews(reviews);
  }

  async analyze(
    team: TeamConfigV1,
    jobType: Exclude<ManagementJobType, 'data_refresh' | 'news_refresh'>,
  ): Promise<JobHandlerResult> {
    if (!team.activeRuleSetId || !this.#rules.getForTeam(team.id, team.activeRuleSetId)) {
      return {
        status: 'needs_attention',
        errorCode: 'ACTIVE_RULES_REQUIRED',
        message: 'Upload, review, and activate league rules before team analysis',
      };
    }
    if (!team.strategyProfileId || !this.#strategies.getForTeam(team.id, team.strategyProfileId)) {
      return {
        status: 'needs_attention',
        errorCode: 'STRATEGY_REQUIRED',
        message: 'Configure a strategy profile before team analysis',
      };
    }
    if (!this.#snapshots.latest('sleeper')) {
      return {
        status: 'needs_attention',
        errorCode: 'PLAYER_DATA_REQUIRED',
        message: 'Run the public data refresh before team analysis',
      };
    }
    if (!this.#analyzeTeam) {
      return {
        status: 'needs_attention',
        errorCode: 'ROSTER_SYNC_REQUIRED',
        message: 'Sync a current ESPN roster snapshot before generating team actions',
      };
    }
    return await this.#analyzeTeam(team, jobType);
  }
}
