import type { PlayerIdentityV1 } from '@ai-ff/domain';

import type { NewsItem, PlayerReview, PlayerSeasonStats, SleeperTrend } from './types.js';

const rankedPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST']);

function percentile(values: number[], value: number): number {
  const evidenced = values.filter((candidate) => candidate > 0);
  if (value <= 0) return 0;
  if (evidenced.length < 2) return 50;
  const below = evidenced.filter((candidate) => candidate < value).length;
  const equal = evidenced.filter((candidate) => candidate === value).length;
  return Math.round(((below + equal / 2) / evidenced.length) * 1000) / 10;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function groupBy<T, K>(values: T[], key: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), value]);
  }
  return groups;
}

export function compilePlayerReviews(input: {
  players: PlayerIdentityV1[];
  stats: PlayerSeasonStats[];
  trends: SleeperTrend[];
  news: NewsItem[];
  now: Date;
}): PlayerReview[] {
  const eligible = input.players.filter((player) => rankedPositions.has(player.position));
  const statsByGsis = groupBy(input.stats, (row) => row.gsisId);
  const trendByPlayer = groupBy(input.trends, (trend) => trend.playerId);
  const newestSeason = Math.max(0, ...input.stats.map((row) => row.season));
  const newsCutoff = input.now.getTime() - 30 * 86_400_000;

  const components = eligible.map((player) => {
    const seasons = [...(player.gsisId ? (statsByGsis.get(player.gsisId) ?? []) : [])].sort(
      (left, right) => right.season - left.season,
    );
    const weighted = seasons.reduce((total, row) => {
      const age = newestSeason - row.season;
      const weight = age === 0 ? 0.62 : age === 1 ? 0.25 : age === 2 ? 0.13 : 0;
      return total + (row.games ? row.fantasyPointsPpr / row.games : 0) * weight;
    }, 0);
    const latest = seasons.find((row) => row.season === newestSeason);
    const opportunity = latest?.games
      ? (latest.targets + latest.carries + latest.passingAttempts * 0.18) / latest.games
      : 0;
    const trends = trendByPlayer.get(player.id) ?? [];
    const adds = trends
      .filter((item) => item.type === 'add')
      .reduce((sum, item) => sum + item.count, 0);
    const drops = trends
      .filter((item) => item.type === 'drop')
      .reduce((sum, item) => sum + item.count, 0);
    const mentions = input.news.filter(
      (item) =>
        Date.parse(item.publishedAt) >= newsCutoff &&
        (item.playerIds.includes(player.id) ||
          `${item.title} ${item.summary}`.toLowerCase().includes(player.fullName.toLowerCase())),
    ).length;
    return { player, seasons, weighted, opportunity, adds, drops, mentions };
  });

  const byPosition = groupBy(components, (item) => item.player.position);
  const scored = components.map((item) => {
    const peers = byPosition.get(item.player.position) ?? [];
    const performanceScore = percentile(
      peers.map((peer) => peer.weighted),
      item.weighted,
    );
    const opportunityScore = percentile(
      peers.map((peer) => peer.opportunity),
      item.opportunity,
    );
    const netAdds = item.adds - item.drops;
    const momentumScore = clamp(50 + Math.sign(netAdds) * Math.log1p(Math.abs(netAdds)) * 9);
    const buzzScore = clamp(Math.log1p(item.mentions) * 35);
    const historyGames = item.seasons.reduce((sum, row) => sum + row.games, 0);
    const hasLatestSeason = item.seasons.some((row) => row.season === newestSeason);
    const confidence = clamp(
      25 +
        Math.min(historyGames, 34) * 1.5 +
        (item.player.gsisId ? 12 : 0) +
        (hasLatestSeason ? 12 : 0),
    );
    const score = clamp(
      performanceScore * 0.55 + opportunityScore * 0.2 + momentumScore * 0.15 + buzzScore * 0.1,
    );
    return {
      ...item,
      performanceScore,
      opportunityScore,
      momentumScore,
      buzzScore,
      confidence,
      score,
    };
  });

  scored.sort(
    (left, right) =>
      right.score - left.score || left.player.fullName.localeCompare(right.player.fullName),
  );
  const positionCounters = new Map<string, number>();
  return scored.map((item, index) => {
    const positionRank = (positionCounters.get(item.player.position) ?? 0) + 1;
    positionCounters.set(item.player.position, positionRank);
    const netAdds = item.adds - item.drops;
    const trend = netAdds > 10 ? 'rising' : netAdds < -10 ? 'falling' : 'steady';
    const strengths: string[] = [];
    const risks: string[] = [];
    if (item.performanceScore >= 75)
      strengths.push('High historical production versus positional peers');
    if (item.opportunityScore >= 75) strengths.push('Strong recent workload and opportunity');
    if (netAdds > 10) strengths.push('Positive 24-hour roster-market momentum');
    if (item.mentions > 0)
      strengths.push(
        `${item.mentions} attributed news mention${item.mentions === 1 ? '' : 's'} in 30 days`,
      );
    if (item.seasons.length === 0)
      risks.push('No matched nflverse season history; rank is low confidence');
    else if (!item.seasons.some((row) => row.season === newestSeason))
      risks.push(`No matched ${newestSeason} regular-season production`);
    if (item.confidence < 60) risks.push('Limited historical sample');
    if (netAdds < -10) risks.push('Negative 24-hour roster-market momentum');
    if (strengths.length === 0)
      strengths.push('Active player with a verified fantasy-platform identity');
    if (risks.length === 0)
      risks.push('News, role, injury, and depth-chart changes can quickly alter value');
    const summary = `${item.player.fullName} ranks ${positionRank} at ${item.player.position}. The independent score is driven primarily by weighted per-game production from the last three available seasons, then opportunity, roster-market momentum, and attributed news attention.`;
    return {
      playerId: item.player.id,
      fullName: item.player.fullName,
      position: item.player.position,
      nflTeam: item.player.nflTeam,
      overallRank: index + 1,
      positionRank,
      score: item.score,
      performanceScore: item.performanceScore,
      opportunityScore: item.opportunityScore,
      momentumScore: item.momentumScore,
      buzzScore: item.buzzScore,
      confidence: item.confidence,
      trend,
      summary,
      strengths,
      risks,
      seasons: item.seasons,
      buzz: {
        adds24h: item.adds,
        drops24h: item.drops,
        netAdds24h: netAdds,
        newsMentions30d: item.mentions,
      },
      sources: [
        {
          label: 'nflverse player statistics',
          url: 'https://github.com/nflverse/nflverse-data/releases/tag/stats_player',
          observedAt: input.now.toISOString(),
        },
        {
          label: 'Sleeper player catalog and trends',
          url: 'https://docs.sleeper.com/',
          observedAt: input.now.toISOString(),
        },
      ],
      generatedAt: input.now.toISOString(),
    } satisfies PlayerReview;
  });
}
