import { XMLParser } from 'fast-xml-parser';

import type { FetchLike, NewsItem, ProviderMetadata, ProviderSnapshot } from './types.js';
import { cleanText, digestBytes, stableUuid } from './utils.js';

export type NewsFeed = {
  name: string;
  url: string;
};

export const rssMetadata: ProviderMetadata = {
  id: 'rss',
  displayName: 'RSS and Atom feeds',
  license: 'Publisher terms apply; metadata and short excerpts only',
  termsUrl: 'https://www.rssboard.org/rss-specification',
  minimumRefreshMinutes: 30,
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function linkValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return String(record['@_href'] ?? record.href ?? '');
  }
  return '';
}

export class RssNewsProvider {
  private readonly parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetchFeed(feed: NewsFeed): Promise<ProviderSnapshot<NewsItem>> {
    const parsedUrl = new URL(feed.url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol))
      throw new Error('News feed must use HTTP(S)');
    const response = await this.fetcher(parsedUrl, {
      headers: { accept: 'application/rss+xml, application/atom+xml, text/xml' },
    });
    if (!response.ok) throw new Error(`${feed.name} feed failed with HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const document = this.parser.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const fetchedAt = this.now().toISOString();
    const records = this.normalizeDocument(document, feed, fetchedAt);
    return {
      provider: rssMetadata,
      fetchedAt,
      sourceUrl: feed.url,
      digest: digestBytes(bytes),
      records,
    };
  }

  private normalizeDocument(
    document: Record<string, unknown>,
    feed: NewsFeed,
    fetchedAt: string,
  ): NewsItem[] {
    const rss = document.rss as { channel?: Record<string, unknown> } | undefined;
    const atom = document.feed as Record<string, unknown> | undefined;
    const rawItems = rss?.channel ? asArray(rss.channel.item) : asArray(atom?.entry);

    return rawItems
      .map<NewsItem | null>((raw) => {
        const item = raw as Record<string, unknown>;
        const title = cleanText(String(item.title ?? ''));
        const url = linkValue(item.link);
        const publishedRaw = String(item.pubDate ?? item.published ?? item.updated ?? fetchedAt);
        const published = new Date(publishedRaw);
        if (!title || !url || Number.isNaN(published.getTime())) return null;
        const summary = cleanText(
          String(item.description ?? item.summary ?? item.content ?? ''),
          600,
        );
        return {
          id: stableUuid('news-item', `${feed.name}:${url}`),
          title,
          summary,
          source: feed.name,
          url,
          publishedAt: published.toISOString(),
          fetchedAt,
          playerIds: [],
        };
      })
      .filter((item): item is NewsItem => item !== null);
  }
}
