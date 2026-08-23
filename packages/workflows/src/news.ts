import type { NewsItem } from '@ai-ff/data';

import type { DecisionPlayer } from './types.js';

export type NewsCategory = 'injury' | 'opportunity' | 'suspension' | 'transaction' | 'general';

export type PlayerNewsAlert = {
  newsId: string;
  playerId: string;
  category: NewsCategory;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  projectionMultiplier: number;
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
  reasons: string[];
};

type Signal = {
  pattern: RegExp;
  category: NewsCategory;
  multiplier: number;
  urgency: PlayerNewsAlert['urgency'];
  reason: string;
};

const signals: Signal[] = [
  {
    pattern: /season[- ]ending|torn acl|placed on injured reserve|out for the season/i,
    category: 'injury',
    multiplier: 0,
    urgency: 'critical',
    reason: 'possible season-ending absence',
  },
  {
    pattern: /ruled out|will not play|inactive/i,
    category: 'injury',
    multiplier: 0,
    urgency: 'critical',
    reason: 'reported unavailable',
  },
  {
    pattern: /doubtful|did not practice|missed practice/i,
    category: 'injury',
    multiplier: 0.45,
    urgency: 'high',
    reason: 'significant availability concern',
  },
  {
    pattern: /limited practice|questionable|day-to-day/i,
    category: 'injury',
    multiplier: 0.78,
    urgency: 'medium',
    reason: 'availability needs monitoring',
  },
  {
    pattern: /named starter|promoted|first-team reps|expanded role|more targets/i,
    category: 'opportunity',
    multiplier: 1.15,
    urgency: 'medium',
    reason: 'role appears to be expanding',
  },
  {
    pattern: /full practice|activated|cleared to play/i,
    category: 'injury',
    multiplier: 1.08,
    urgency: 'medium',
    reason: 'availability appears to be improving',
  },
  {
    pattern: /suspended|suspension/i,
    category: 'suspension',
    multiplier: 0.2,
    urgency: 'high',
    reason: 'reported suspension risk',
  },
  {
    pattern: /traded|released|signed|waived/i,
    category: 'transaction',
    multiplier: 1,
    urgency: 'medium',
    reason: 'team context changed',
  },
];

function mentionedPlayers(item: NewsItem, players: DecisionPlayer[]): DecisionPlayer[] {
  const linked = new Set(item.playerIds);
  const text = `${item.title} ${item.summary}`.toLowerCase();
  return players.filter(
    (player) => linked.has(player.playerId) || text.includes(player.name.toLowerCase()),
  );
}

export function classifyPlayerNews(
  items: NewsItem[],
  players: DecisionPlayer[],
): PlayerNewsAlert[] {
  return items
    .flatMap<PlayerNewsAlert>((item) => {
      const text = `${item.title} ${item.summary}`;
      const matches = signals.filter((signal) => signal.pattern.test(text));
      const strongest = matches.sort((left, right) => left.multiplier - right.multiplier)[0];
      return mentionedPlayers(item, players).map((player) => ({
        newsId: item.id,
        playerId: player.playerId,
        category: strongest?.category ?? 'general',
        urgency: strongest?.urgency ?? 'low',
        projectionMultiplier: strongest?.multiplier ?? 1,
        headline: item.title,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
        reasons: matches.length > 0 ? matches.map((match) => match.reason) : ['player mentioned'],
      }));
    })
    .sort((left, right) => {
      const priority = { critical: 3, high: 2, medium: 1, low: 0 };
      return (
        priority[right.urgency] - priority[left.urgency] ||
        right.publishedAt.localeCompare(left.publishedAt)
      );
    });
}
