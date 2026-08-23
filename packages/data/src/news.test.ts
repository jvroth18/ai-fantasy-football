import { describe, expect, it } from 'vitest';

import { RssNewsProvider } from './news.js';

describe('RSS news provider', () => {
  it('stores metadata and a short plain-text excerpt rather than article bodies', async () => {
    const xml = `
      <rss version="2.0"><channel><title>Football Wire</title><item>
        <title>Rookie earns first-team reps</title>
        <link>https://example.com/rookie</link>
        <pubDate>Sun, 23 Aug 2026 12:00:00 GMT</pubDate>
        <description><![CDATA[<p>A concise practice report.</p>]]></description>
      </item></channel></rss>`;
    const provider = new RssNewsProvider(
      async () => new Response(xml, { headers: { 'content-type': 'application/rss+xml' } }),
      () => new Date('2026-08-23T13:00:00.000Z'),
    );

    const snapshot = await provider.fetchFeed({
      name: 'Football Wire',
      url: 'https://example.com/rss',
    });

    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]).toMatchObject({
      title: 'Rookie earns first-team reps',
      summary: 'A concise practice report.',
      source: 'Football Wire',
      url: 'https://example.com/rookie',
    });
  });
});
