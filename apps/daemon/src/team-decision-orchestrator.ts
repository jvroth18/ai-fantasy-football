import { createHash, randomUUID } from 'node:crypto';

import type { NewsItem, SleeperTrend } from '@ai-ff/data';
import {
  DataSnapshotRepository,
  NewsRepository,
  PlayerRepository,
  PortalSnapshotRepository,
  RecommendationRepository,
  RuleSetRepository,
  StrategyRepository,
  type AppDatabase,
} from '@ai-ff/db';
import type {
  LeagueRuleSetV1,
  RecommendationV1,
  SourceEvidence,
  StrategyProfileV1,
  TeamConfigV1,
} from '@ai-ff/domain';
import type { EspnPortalSnapshot } from '@ai-ff/espn';
import type { JobHandlerResult, ManagementJobType } from '@ai-ff/scheduler';
import {
  classifyPlayerNews,
  generateTradeProposals,
  optimizeLineup,
  picksUntilNextSnakeTurn,
  rankDraftCandidates,
  rankWaiverMoves,
  type DecisionPlayer,
  type DropCandidate,
  type LineupPlayer,
  type Position,
  type RosterSlot,
  type TeamNeeds,
  type WaiverCandidate,
} from '@ai-ff/workflows';

import type {
  PlayerValueCandidate,
  PlayerValueHorizon,
  PlayerValueProvider,
  ValuedDecisionPlayer,
} from './codex-player-values.js';
import { portalSnapshotView, type PortalSnapshotView } from './espn-snapshot-service.js';

type AnalysisJobType = Exclude<ManagementJobType, 'data_refresh' | 'news_refresh'>;

export type TeamDecisionOrchestratorOptions = {
  syncPortal?: (team: TeamConfigV1) => Promise<PortalSnapshotView>;
  now?: () => Date;
};

const supportedPositions = new Set<Position>([
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DST',
  'DL',
  'LB',
  'DB',
  'IDP',
]);
const supportedSlots = new Set<RosterSlot>([
  'QB',
  'RB',
  'WR',
  'TE',
  'FLEX',
  'SUPERFLEX',
  'K',
  'DST',
  'DL',
  'LB',
  'DB',
  'IDP',
  'BENCH',
  'IR',
]);

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function normalizePosition(value: string): Position | null {
  const normalized = value.toUpperCase().replaceAll(' ', '');
  const mapped = normalized === 'D/ST' || normalized === 'DEF' ? 'DST' : normalized;
  return supportedPositions.has(mapped as Position) ? (mapped as Position) : null;
}

function normalizeSlot(value: string): RosterSlot | null {
  const normalized = value.toUpperCase().replaceAll(' ', '');
  const aliases: Record<string, RosterSlot> = {
    BE: 'BENCH',
    BENCH: 'BENCH',
    'D/ST': 'DST',
    DEF: 'DST',
    OP: 'SUPERFLEX',
    UTIL: 'FLEX',
    'RB/WR': 'FLEX',
    'RB/WR/TE': 'FLEX',
    RES: 'IR',
  };
  const mapped = aliases[normalized] ?? normalized;
  return supportedSlots.has(mapped as RosterSlot) ? (mapped as RosterSlot) : null;
}

function candidateFromPortal(
  player: Pick<EspnPortalSnapshot['roster'][number], 'playerId' | 'name' | 'position' | 'nflTeam'>,
): PlayerValueCandidate | null {
  const position = normalizePosition(player.position);
  if (!position) return null;
  return {
    playerId: player.playerId,
    name: player.name,
    position,
    nflTeam: player.nflTeam,
  };
}

function uniqueCandidates(players: Array<PlayerValueCandidate | null>): PlayerValueCandidate[] {
  const unique = new Map<string, PlayerValueCandidate>();
  for (const player of players) {
    if (player && !unique.has(player.playerId)) unique.set(player.playerId, player);
  }
  return [...unique.values()];
}

function safeNews(rows: ReturnType<NewsRepository['listRecent']>): NewsItem[] {
  const result: NewsItem[] = [];
  for (const row of rows) {
    try {
      const item = JSON.parse(row.newsJson) as Partial<NewsItem>;
      if (
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.summary === 'string' &&
        typeof item.source === 'string' &&
        typeof item.url === 'string' &&
        typeof item.publishedAt === 'string' &&
        typeof item.fetchedAt === 'string' &&
        Array.isArray(item.playerIds)
      ) {
        result.push(item as NewsItem);
      }
    } catch {
      // Ignore a corrupt cached item without discarding other attributable news.
    }
  }
  return result;
}

function isSnapshotFresh(view: PortalSnapshotView, now: Date, maximumMinutes: number): boolean {
  const observedAt = Date.parse(view.observedAt);
  const age = now.getTime() - observedAt;
  return Number.isFinite(age) && age >= 0 && age <= maximumMinutes * 60_000;
}

function maximumSnapshotAge(team: TeamConfigV1, jobType: AnalysisJobType): number {
  const jobMaximum = jobType === 'lineup_watch' ? 30 : 60;
  return Math.min(team.automation.minimumDataFreshnessMinutes, jobMaximum);
}

function expiryFor(type: RecommendationV1['type'], now: Date): string {
  const duration =
    type === 'lineup'
      ? 6 * 60 * 60_000
      : type === 'trade'
        ? 7 * 24 * 60 * 60_000
        : 24 * 60 * 60_000;
  return new Date(now.getTime() + duration).toISOString();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[], fallback = 0.5): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function portalEvidence(view: PortalSnapshotView): SourceEvidence {
  return {
    sourceType: 'espn_scan',
    sourceName: 'Verified ESPN visible portal snapshot',
    sourceDigest: view.digest,
    locator: `league ${view.leagueId}, team ${view.platformTeamId}`,
    confidence: 1,
    observedAt: view.observedAt,
  };
}

function ruleEvidence(rules: LeagueRuleSetV1, observedAt: string): SourceEvidence {
  return (
    rules.evidence[0] ?? {
      sourceType: 'manual',
      sourceName: `${rules.name} active rules revision ${rules.revision}`,
      sourceDigest: digest(JSON.stringify(rules)),
      locator: rules.id,
      confidence: 1,
      observedAt,
    }
  );
}

function evidenceFor(
  view: PortalSnapshotView,
  rules: LeagueRuleSetV1,
  players: ValuedDecisionPlayer[],
  observedAt: string,
): SourceEvidence[] {
  const urls = [...new Set(players.flatMap((player) => player.sourceUrls))].slice(0, 3);
  return [
    portalEvidence(view),
    ruleEvidence(rules, observedAt),
    ...urls.map<SourceEvidence>((url) => {
      let name = 'Public player research';
      try {
        name = new URL(url).hostname;
      } catch {
        // URL syntax was already validated by the value provider.
      }
      return {
        sourceType: 'provider',
        sourceName: name,
        sourceDigest: digest(url),
        locator: url,
        confidence: 0.8,
        observedAt,
      };
    }),
  ];
}

function recommendation(
  teamId: string,
  type: RecommendationV1['type'],
  values: Omit<
    RecommendationV1,
    'schemaVersion' | 'id' | 'teamId' | 'type' | 'alternativeIds' | 'createdAt' | 'expiresAt'
  >,
  now: Date,
): RecommendationV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    type,
    ...values,
    alternativeIds: [],
    createdAt: now.toISOString(),
    expiresAt: expiryFor(type, now),
  };
}

function starterSlots(rules: LeagueRuleSetV1): Set<RosterSlot> {
  return new Set(rules.roster.filter((slot) => slot.starter).map((slot) => slot.slot));
}

function teamNeeds(rules: LeagueRuleSetV1, players: DecisionPlayer[]): TeamNeeds {
  const positions = [...supportedPositions];
  return Object.fromEntries(
    positions.flatMap((position) => {
      const demand = rules.roster.reduce((total, slot) => {
        if (!slot.starter || !slot.eligiblePositions.includes(position)) return total;
        return total + slot.count / slot.eligiblePositions.length;
      }, 0);
      const count = players.filter((player) => player.position === position).length;
      if (demand === 0 && count === 0) return [];
      const gap = demand - count;
      const weight = gap > 0 ? Math.min(1.6, 1 + gap * 0.5) : Math.max(0.6, 0.9 + gap * 0.2);
      return [[position, Number(weight.toFixed(3))]];
    }),
  ) as TeamNeeds;
}

function applyWeeklyNews(
  players: ValuedDecisionPlayer[],
  news: NewsItem[],
): ValuedDecisionPlayer[] {
  const strongestByPlayer = new Map<string, ReturnType<typeof classifyPlayerNews>[number]>();
  for (const alert of classifyPlayerNews(news, players)) {
    if (!strongestByPlayer.has(alert.playerId)) strongestByPlayer.set(alert.playerId, alert);
  }
  return players.map((player) => {
    const alert = strongestByPlayer.get(player.playerId);
    if (!alert || alert.projectionMultiplier === 1) return player;
    const multiplier = alert.projectionMultiplier;
    return {
      ...player,
      p10: Number((player.p10 * multiplier).toFixed(3)),
      p50: Number((player.p50 * multiplier).toFixed(3)),
      p90: Number((player.p90 * multiplier).toFixed(3)),
      injuryRisk: clamp(Math.max(player.injuryRisk, 1 - multiplier)),
      rationale: `${player.rationale} ${alert.headline}: ${alert.reasons.join(', ')}.`,
      sourceUrls: [...new Set([...player.sourceUrls, alert.url])],
    };
  });
}

function slotIndexes(snapshot: EspnPortalSnapshot): Map<string, number> {
  const indexes = new Map<RosterSlot, number>();
  const result = new Map<string, number>();
  for (const entry of snapshot.roster) {
    const slot = normalizeSlot(entry.slot);
    if (!slot) continue;
    const index = indexes.get(slot) ?? 0;
    indexes.set(slot, index + 1);
    result.set(entry.playerId, index);
  }
  return result;
}

function lineupPlayers(
  valued: ValuedDecisionPlayer[],
  snapshot: EspnPortalSnapshot,
): LineupPlayer[] {
  const byId = new Map(valued.map((player) => [player.playerId, player]));
  const indexes = slotIndexes(snapshot);
  return snapshot.roster.flatMap<LineupPlayer>((entry) => {
    const player = byId.get(entry.playerId);
    const currentSlot = normalizeSlot(entry.slot);
    if (!player || !currentSlot) return [];
    return [
      {
        ...player,
        currentSlot,
        currentSlotIndex: indexes.get(entry.playerId) ?? 0,
        locked: entry.locked,
        unavailable: ['out', 'ir', 'suspended'].includes(entry.availability),
      },
    ];
  });
}

function currentLineupMedian(rules: LeagueRuleSetV1, players: LineupPlayer[]): number {
  const starters = starterSlots(rules);
  return players
    .filter((player) => starters.has(player.currentSlot) && !player.unavailable)
    .reduce((sum, player) => sum + player.p50, 0);
}

export class TeamDecisionOrchestrator {
  readonly #rules: RuleSetRepository;
  readonly #strategies: StrategyRepository;
  readonly #recommendations: RecommendationRepository;
  readonly #portalSnapshots: PortalSnapshotRepository;
  readonly #news: NewsRepository;
  readonly #dataSnapshots: DataSnapshotRepository;
  readonly #players: PlayerRepository;
  readonly #syncPortal: ((team: TeamConfigV1) => Promise<PortalSnapshotView>) | null;
  readonly #now: () => Date;

  constructor(
    database: AppDatabase,
    readonly values: PlayerValueProvider,
    options: TeamDecisionOrchestratorOptions = {},
  ) {
    this.#rules = new RuleSetRepository(database);
    this.#strategies = new StrategyRepository(database);
    this.#recommendations = new RecommendationRepository(database);
    this.#portalSnapshots = new PortalSnapshotRepository(database);
    this.#news = new NewsRepository(database);
    this.#dataSnapshots = new DataSnapshotRepository(database);
    this.#players = new PlayerRepository(database);
    this.#syncPortal = options.syncPortal ?? null;
    this.#now = options.now ?? (() => new Date());
  }

  async analyze(team: TeamConfigV1, jobType: AnalysisJobType): Promise<JobHandlerResult> {
    const now = this.#now();
    const rules = team.activeRuleSetId
      ? this.#rules.getForTeam(team.id, team.activeRuleSetId)
      : null;
    const strategy = team.strategyProfileId
      ? this.#strategies.getForTeam(team.id, team.strategyProfileId)
      : null;
    if (!rules || !strategy) {
      return {
        status: 'needs_attention',
        errorCode: 'TEAM_CONFIGURATION_CHANGED',
        message: 'Active rules or strategy changed before analysis began',
      };
    }

    let portal: PortalSnapshotView | null = null;
    const stored = this.#portalSnapshots.latestForTeam(team.id);
    if (stored) portal = portalSnapshotView(stored);
    const maximumAge = maximumSnapshotAge(team, jobType);
    if (!portal || !isSnapshotFresh(portal, now, maximumAge)) {
      if (this.#syncPortal) {
        try {
          portal = await this.#syncPortal(team);
        } catch (error) {
          return {
            status: 'needs_attention',
            errorCode: 'ESPN_SYNC_REQUIRED',
            message:
              `Could not refresh the visible ESPN snapshot: ${error instanceof Error ? error.message : String(error)}`.slice(
                0,
                500,
              ),
          };
        }
      }
    }
    if (!portal) {
      return {
        status: 'needs_attention',
        errorCode: 'ESPN_SNAPSHOT_REQUIRED',
        message: 'Sync the authenticated ESPN team before generating recommendations',
      };
    }
    if (!isSnapshotFresh(portal, now, maximumAge)) {
      return {
        status: 'needs_attention',
        errorCode: 'ESPN_SNAPSHOT_STALE',
        message: `The latest verified ESPN snapshot is older than ${maximumAge} minutes`,
      };
    }

    const news = safeNews(this.#news.listRecent(200));
    try {
      if (jobType === 'trade_market') {
        return await this.#analyzeTrades(team, rules, strategy, portal, news, now);
      }
      if (portal.snapshot.draft.status !== 'complete') {
        if (jobType === 'daily_manager') {
          return await this.#analyzeDraft(team, rules, strategy, portal, news, now);
        }
        return {
          status: 'verified',
          message: `${jobType} skipped while the league draft is ${portal.snapshot.draft.status}`,
        };
      }
      if (jobType === 'lineup_watch') {
        return await this.#analyzeLineup(team, rules, strategy, portal, news, now);
      }
      if (jobType === 'waiver_plan') {
        return await this.#analyzeWaivers(team, rules, strategy, portal, news, now);
      }
      return await this.#analyzeDaily(team, rules, strategy, portal, news, now);
    } catch (error) {
      return {
        status: 'needs_attention',
        errorCode: 'DECISION_ENGINE_FAILED',
        message:
          `Decision analysis stopped without replacing prior advice: ${error instanceof Error ? error.message : String(error)}`.slice(
            0,
            500,
          ),
      };
    }
  }

  async #value(
    team: TeamConfigV1,
    rules: LeagueRuleSetV1,
    strategy: StrategyProfileV1,
    news: NewsItem[],
    horizon: PlayerValueHorizon,
    candidates: PlayerValueCandidate[],
  ): Promise<ValuedDecisionPlayer[]> {
    return await this.values.valuePlayers({
      teamName: team.name,
      season: team.season,
      horizon,
      players: candidates,
      rules,
      strategy,
      news,
    });
  }

  async #analyzeDaily(
    team: TeamConfigV1,
    rules: LeagueRuleSetV1,
    strategy: StrategyProfileV1,
    portal: PortalSnapshotView,
    news: NewsItem[],
    now: Date,
  ): Promise<JobHandlerResult> {
    const [lineup, waivers] = await Promise.all([
      this.#lineupRecommendations(team, rules, strategy, portal, news, now),
      this.#waiverRecommendations(team, rules, strategy, portal, news, now),
    ]);
    const created = [...lineup, ...waivers];
    this.#recommendations.replaceActiveForTypes(
      team.id,
      ['lineup', 'waiver'],
      created,
      now.toISOString(),
    );
    return {
      status: 'verified',
      message: `${lineup.length} lineup and ${waivers.length} waiver recommendations refreshed`,
    };
  }

  async #analyzeLineup(
    team: TeamConfigV1,
    rules: LeagueRuleSetV1,
    strategy: StrategyProfileV1,
    portal: PortalSnapshotView,
    news: NewsItem[],
    now: Date,
  ): Promise<JobHandlerResult> {
    const created = await this.#lineupRecommendations(team, rules, strategy, portal, news, now);
    this.#recommendations.replaceActiveForTypes(team.id, ['lineup'], created, now.toISOString());
    return { status: 'verified', message: `${created.length} lineup recommendations refreshed` };
  }

  async #lineupRecommendations(
    team: TeamConfigV1,
    rules: LeagueRuleSetV1,
    strategy: StrategyProfileV1,
    portal: PortalSnapshotView,
    news: NewsItem[],
    now: Date,
  ): Promise<RecommendationV1[]> {
    const candidates = uniqueCandidates(portal.snapshot.roster.map(candidateFromPortal));
    const valued = applyWeeklyNews(
      await this.#value(team, rules, strategy, news, 'next_scoring_period', candidates),
      news,
    );
    const roster = lineupPlayers(valued, portal.snapshot);
    const optimized = optimizeLineup(rules, roster, strategy.riskTolerance);
    const byId = new Map(valued.map((player) => [player.playerId, player]));
    const result: RecommendationV1[] = [];
    if (optimized && optimized.changes.length > 0) {
      const changed = optimized.changes
        .map((change) => byId.get(change.playerId))
        .filter((player): player is ValuedDecisionPlayer => player !== undefined);
      const moves = optimized.changes
        .map((change) => {
          const player = byId.get(change.playerId);
          return player
            ? `${player.name}: ${change.fromSlot} to ${change.toSlot}`
            : `${change.playerId}: ${change.fromSlot} to ${change.toSlot}`;
        })
        .join('; ');
      result.push(
        recommendation(
          team.id,
          'lineup',
          {
            title: `Set the higher-upside ${optimized.changes.length === 1 ? 'starter' : 'lineup'}`,
            rationale: `${moves}. Optimized scoring range: ${optimized.p10.toFixed(1)}-${optimized.p90.toFixed(1)} points.`,
            projectedPointDelta: Number(
              (optimized.p50 - currentLineupMedian(rules, roster)).toFixed(3),
            ),
            projectedWinProbabilityDelta: null,
            risk: clamp(
              average(changed.map((player) => Math.max(player.injuryRisk, player.bustRisk))),
            ),
            confidence: clamp(average(changed.map((player) => player.mappingConfidence))),
            evidence: evidenceFor(portal, rules, changed, now.toISOString()),
          },
          now,
        ),
      );
    }

    const alerts = classifyPlayerNews(news, valued)
      .filter((alert) => alert.urgency === 'critical' || alert.urgency === 'high')
      .filter((alert) => portal.snapshot.roster.some((entry) => entry.playerId === alert.playerId));
    for (const alert of alerts.slice(0, 3)) {
      if (result.some((item) => item.rationale.includes(alert.headline))) continue;
      const player = byId.get(alert.playerId);
      if (!player) continue;
      result.push(
        recommendation(
          team.id,
          'lineup',
          {
            title: `${player.name}: ${alert.urgency} lineup alert`,
            rationale: `${alert.headline}. ${alert.reasons.join('; ')}. Review availability before lock.`,
            projectedPointDelta: null,
            projectedWinProbabilityDelta: null,
            risk: clamp(Math.max(player.injuryRisk, 1 - alert.projectionMultiplier)),
            confidence: player.mappingConfidence,
            evidence: evidenceFor(portal, rules, [player], now.toISOString()),
          },
          now,
        ),
      );
    }
    return result;
  }

  #sleeperAddTrends(): Map<string, number> {
    const snapshot = this.#dataSnapshots.latest('sleeper');
    if (!snapshot) return new Map();
    let trends: SleeperTrend[];
    try {
      const metadata = JSON.parse(snapshot.metadataJson) as { adds?: SleeperTrend[] };
      trends = Array.isArray(metadata.adds) ? metadata.adds : [];
    } catch {
      return new Map();
    }
    const countsBySleeperId = new Map(trends.map((trend) => [trend.playerId, trend.count]));
    const result = new Map<string, number>();
    for (const identity of this.#players.list()) {
      if (!identity.sleeperId) continue;
      const count = countsBySleeperId.get(identity.sleeperId);
      if (count === undefined) continue;
      if (identity.espnId) result.set(`id:${identity.espnId}`, count);
      result.set(`name:${normalizeName(identity.fullName)}`, count);
    }
    return result;
  }

  async #analyzeWaivers(
    team: TeamConfigV1,
    rules: LeagueRuleSetV1,
    strategy: StrategyProfileV1,
    portal: PortalSnapshotView,
    news: NewsItem[],
    now: Date,
  ): Promise<JobHandlerResult> {
    const created = await this.#waiverRecommendations(team, rules, strategy, portal, news, now);
    this.#recommendations.replaceActiveForTypes(team.id, ['waiver'], created, now.toISOString());
    return { status: 'verified', message: `${created.length} waiver recommendations refreshed` };
  }

  async #waiverRecommendations(
    team: TeamConfigV1,
    rules: LeagueRuleSetV1,
    strategy: StrategyProfileV1,
    portal: PortalSnapshotView,
    news: NewsItem[],
    now: Date,
  ): Promise<RecommendationV1[]> {
    const available = portal.snapshot.availablePlayers.slice(0, 60);
    const candidates = uniqueCandidates([
      ...portal.snapshot.roster.map(candidateFromPortal),
      ...available.map(candidateFromPortal),
    ]);
    const valued = await this.#value(team, rules, strategy, news, 'rest_of_season', candidates);
    const byId = new Map(valued.map((player) => [player.playerId, player]));
    const trends = this.#sleeperAddTrends();
    const pending = new Set(
      portal.snapshot.waiverClaims
        .filter((claim) => claim.status === 'pending')
        .map((claim) => claim.addPlayerId),
    );
    const waiverCandidates = available.flatMap<WaiverCandidate>((entry) => {
      const player = byId.get(entry.playerId);
      if (!player || pending.has(entry.playerId)) return [];
      return [
        {
          ...player,
          addTrend:
            trends.get(`id:${entry.playerId}`) ??
            trends.get(`name:${normalizeName(entry.name)}`) ??
            0,
          rosteredPercent: entry.rosteredPercent ?? 0,
          claimRequired: entry.acquisitionType !== 'free_agent',
        },
      ];
    });
    const starters = starterSlots(rules);
    const drops = portal.snapshot.roster.flatMap<DropCandidate>((entry) => {
      const player = byId.get(entry.playerId);
      const slot = normalizeSlot(entry.slot);
      if (!player || !slot) return [];
      return [
        {
          ...player,
          protected: strategy.protectedPlayerIds.includes(player.playerId),
          locked: entry.locked,
          starter: starters.has(slot),
        },
      ];
    });
    const ranked = rankWaiverMoves({
      candidates: waiverCandidates,
      drops,
      strategy,
      automation: team.automation,
      waivers: rules.waivers,
      faabRemaining: portal.snapshot.faabRemaining,
      faabSpentThisWeek: portal.snapshot.faabSpentThisWeek ?? 0,
    });
    return ranked.slice(0, 5).map((move) => {
      const related = [move.add.playerId, move.drop?.playerId].flatMap((playerId) => {
        const player = playerId ? byId.get(playerId) : undefined;
        return player ? [player] : [];
      });
      const addValuation = byId.get(move.add.playerId);
      const bid = move.bid === null ? '' : ` Bid $${move.bid} FAAB.`;
      const drop = move.drop ? ` and drop ${move.drop.name}` : '';
      return recommendation(
        team.id,
        'waiver',
        {
          title: `Add ${move.add.name}${drop}`,
          rationale: `${move.reasons.join('; ')}.${bid} ${addValuation?.rationale ?? ''}`.trim(),
          projectedPointDelta: move.projectedPointDelta,
          projectedWinProbabilityDelta: null,
          risk: clamp(Math.max(move.add.injuryRisk, move.add.bustRisk)),
          confidence: clamp(
            move.add.mappingConfidence *
              (move.add.rosteredPercent === 0 ? 0.85 : 1) *
              (move.actionType === 'waiver_claim' ? 0.95 : 1),
          ),
          evidence: evidenceFor(portal, rules, related, now.toISOString()),
        },
        now,
      );
    });
  }

  async #analyzeDraft(
    team: TeamConfigV1,
    rules: LeagueRuleSetV1,
    strategy: StrategyProfileV1,
    portal: PortalSnapshotView,
    news: NewsItem[],
    now: Date,
  ): Promise<JobHandlerResult> {
    const available = portal.snapshot.availablePlayers.slice(0, 80);
    const candidates = uniqueCandidates([
      ...portal.snapshot.roster.map(candidateFromPortal),
      ...available.map(candidateFromPortal),
    ]);
    const valued = await this.#value(team, rules, strategy, news, 'draft_season', candidates);
    const byId = new Map(valued.map((player) => [player.playerId, player]));
    const roster = portal.snapshot.roster.flatMap((entry) => {
      const player = byId.get(entry.playerId);
      return player ? [player] : [];
    });
    const draftCandidates = available.flatMap((entry) => {
      const player = byId.get(entry.playerId);
      return player ? [player] : [];
    });
    const overallPick = portal.snapshot.draft.picks.length + 1;
    let picksUntilNext = rules.draft.teamCount;
    if (rules.draft.type === 'snake' && portal.snapshot.draft.draftSlot !== null) {
      picksUntilNext = picksUntilNextSnakeTurn(
        overallPick,
        portal.snapshot.draft.draftSlot,
        rules.draft.teamCount,
      );
    }
    const ranked = rankDraftCandidates(draftCandidates, {
      overallPick,
      picksUntilNext,
      roster,
      rules,
      strategy,
      automation: team.automation,
    });
    const created = ranked.slice(0, 5).flatMap((ranking) => {
      const valuedPlayer = byId.get(ranking.player.playerId);
      if (!valuedPlayer) return [];
      return [
        recommendation(
          team.id,
          'draft',
          {
            title:
              portal.snapshot.draft.onClockTeamId === team.espnTeamId
                ? `Draft ${ranking.player.name} at pick ${overallPick}`
                : `Queue ${ranking.player.name} for pick ${overallPick}`,
            rationale: `${ranking.reasons.join('; ')}. ${valuedPlayer.rationale}`,
            projectedPointDelta: ranking.valueOverReplacement,
            projectedWinProbabilityDelta: null,
            risk: clamp(Math.max(ranking.player.injuryRisk, ranking.player.bustRisk)),
            confidence: ranking.player.mappingConfidence,
            evidence: evidenceFor(portal, rules, [valuedPlayer], now.toISOString()),
          },
          now,
        ),
      ];
    });
    this.#recommendations.replaceActiveForTypes(team.id, ['draft'], created, now.toISOString());
    return { status: 'verified', message: `${created.length} draft recommendations refreshed` };
  }

  async #analyzeTrades(
    team: TeamConfigV1,
    rules: LeagueRuleSetV1,
    strategy: StrategyProfileV1,
    portal: PortalSnapshotView,
    news: NewsItem[],
    now: Date,
  ): Promise<JobHandlerResult> {
    if (portal.snapshot.leagueTeams.length === 0) {
      return {
        status: 'needs_attention',
        errorCode: 'OPPONENT_ROSTERS_REQUIRED',
        message: 'Refresh ESPN with visible opponent rosters before trade analysis',
      };
    }
    const candidates = uniqueCandidates([
      ...portal.snapshot.roster.map(candidateFromPortal),
      ...portal.snapshot.leagueTeams.flatMap((opponent) =>
        opponent.roster.slice(0, 12).map(candidateFromPortal),
      ),
    ]);
    const valued = await this.#value(team, rules, strategy, news, 'rest_of_season', candidates);
    const byId = new Map(valued.map((player) => [player.playerId, player]));
    const ownPlayers = portal.snapshot.roster.flatMap((entry) => {
      const player = byId.get(entry.playerId);
      return player ? [player] : [];
    });
    const opponentNameById = new Map(
      portal.snapshot.leagueTeams.map((opponent) => [opponent.teamId, opponent.name]),
    );
    const opponents = portal.snapshot.leagueTeams.map((opponent) => {
      const players = opponent.roster.slice(0, 12).flatMap((entry) => {
        const player = byId.get(entry.playerId);
        return player ? [player] : [];
      });
      return { teamId: opponent.teamId, players, needs: teamNeeds(rules, players) };
    });
    const proposals = generateTradeProposals(
      { teamId: team.id, players: ownPlayers, needs: teamNeeds(rules, ownPlayers) },
      opponents,
      strategy,
      20,
    ).filter(
      (proposal, index, all) =>
        all
          .slice(0, index)
          .filter((candidate) => candidate.opponentTeamId === proposal.opponentTeamId).length <
        strategy.maximumTradeOffersPerOpponentPerWeek,
    );
    const created = proposals.slice(0, 8).map((proposal) => {
      const related = [...proposal.send, ...proposal.receive].flatMap((candidate) => {
        const player = byId.get(candidate.playerId);
        return player ? [player] : [];
      });
      const send = proposal.send.map((player) => player.name).join(' + ');
      const receive = proposal.receive.map((player) => player.name).join(' + ');
      return recommendation(
        team.id,
        'trade',
        {
          title: `Offer ${send} for ${receive}`,
          rationale: `Propose to ${opponentNameById.get(proposal.opponentTeamId) ?? proposal.opponentTeamId}. ${proposal.reasons.join('; ')}.`,
          projectedPointDelta: proposal.projectedGain,
          projectedWinProbabilityDelta: null,
          risk: clamp(
            average(
              proposal.receive.map((player) => Math.max(player.injuryRisk, player.bustRisk)),
            ) +
              Math.abs(1 - proposal.fairnessRatio) / 2,
          ),
          confidence: clamp(average(related.map((player) => player.mappingConfidence))),
          evidence: evidenceFor(portal, rules, related, now.toISOString()),
        },
        now,
      );
    });
    this.#recommendations.replaceActiveForTypes(team.id, ['trade'], created, now.toISOString());
    return { status: 'verified', message: `${created.length} trade proposals refreshed` };
  }
}
