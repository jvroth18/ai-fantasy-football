import type { NewsItem } from '@ai-ff/data';
import { describe, expect, it } from 'vitest';

import { classifyPlayerNews } from './news.js';
import { playerFixture, testNow } from './test-fixtures.js';

describe('news classification', () => {
  it('links named players and escalates concrete availability news', () => {
    const player = playerFixture({ playerId: 'player-1', name: 'Jordan Example' });
    const item: NewsItem = {
      id: 'news-1',
      title: 'Jordan Example ruled out for Sunday',
      summary: 'The team listed him inactive after he did not practice.',
      source: 'Team Wire',
      url: 'https://example.com/news-1',
      publishedAt: testNow,
      fetchedAt: testNow,
      playerIds: [],
    };

    const alerts = classifyPlayerNews([item], [player]);

    expect(alerts[0]).toMatchObject({
      playerId: 'player-1',
      category: 'injury',
      urgency: 'critical',
      projectionMultiplier: 0,
    });
    expect(alerts[0]?.reasons).toEqual(
      expect.arrayContaining(['reported unavailable', 'significant availability concern']),
    );
  });

  it('does not create alerts for unrelated players', () => {
    const item: NewsItem = {
      id: 'news-2',
      title: 'Another player named starter',
      summary: '',
      source: 'Team Wire',
      url: 'https://example.com/news-2',
      publishedAt: testNow,
      fetchedAt: testNow,
      playerIds: [],
    };
    expect(classifyPlayerNews([item], [playerFixture({ name: 'Jordan Example' })])).toEqual([]);
  });
});
