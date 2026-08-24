import type { PlayerIdentityV1 } from '@ai-ff/domain';

export type ProviderMetadata = {
  id: string;
  displayName: string;
  license: string;
  termsUrl: string;
  minimumRefreshMinutes: number;
};

export type ProviderSnapshot<T> = {
  provider: ProviderMetadata;
  fetchedAt: string;
  sourceUrl: string;
  digest: string;
  records: T[];
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SleeperTrend = {
  playerId: string;
  type: 'add' | 'drop';
  count: number;
  lookbackHours: number;
};

export type PlayerCatalogSnapshot = ProviderSnapshot<PlayerIdentityV1>;

export type NewsItem = {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  fetchedAt: string;
  playerIds: string[];
};

export type NflverseAsset = {
  dataset: string;
  name: string;
  url: string;
  contentType: string;
  size: number;
  updatedAt: string;
};

export type PlayerSeasonStats = {
  gsisId: string;
  season: number;
  games: number;
  fantasyPoints: number;
  fantasyPointsPpr: number;
  passingAttempts: number;
  carries: number;
  targets: number;
  receptions: number;
  touchdowns: number;
};

export type PlayerReview = {
  playerId: string;
  fullName: string;
  position: PlayerIdentityV1['position'];
  nflTeam: string | null;
  overallRank: number;
  positionRank: number;
  score: number;
  performanceScore: number;
  opportunityScore: number;
  momentumScore: number;
  buzzScore: number;
  confidence: number;
  trend: 'rising' | 'steady' | 'falling';
  summary: string;
  strengths: string[];
  risks: string[];
  seasons: PlayerSeasonStats[];
  buzz: {
    adds24h: number;
    drops24h: number;
    netAdds24h: number;
    newsMentions30d: number;
  };
  sources: Array<{ label: string; url: string; observedAt: string }>;
  generatedAt: string;
};
