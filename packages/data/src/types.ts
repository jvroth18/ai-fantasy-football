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
