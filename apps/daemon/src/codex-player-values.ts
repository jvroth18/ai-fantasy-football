import type { CodexAppServerClient, JsonValue } from '@ai-ff/codex';
import type { NewsItem } from '@ai-ff/data';
import type { LeagueRuleSetV1, StrategyProfileV1 } from '@ai-ff/domain';
import type { DecisionPlayer, Position } from '@ai-ff/workflows';
import { z } from 'zod';

const valuationSchema = z
  .object({
    playerId: z.string().min(1),
    p10: z.number().finite(),
    p50: z.number().finite(),
    p90: z.number().finite(),
    replacementValue: z.number().finite(),
    adp: z.number().positive().nullable(),
    tier: z.number().int().min(1).max(30),
    byeWeek: z.number().int().min(1).max(18).nullable(),
    injuryRisk: z.number().min(0).max(1),
    breakoutScore: z.number().min(0).max(1),
    bustRisk: z.number().min(0).max(1),
    identityConfidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(500),
    sourceUrls: z.array(z.string().url()).min(1).max(5),
  })
  .refine((value) => value.p10 <= value.p50 && value.p50 <= value.p90, {
    message: 'Valuation percentiles must be ordered p10 <= p50 <= p90',
  });

const responseSchema = z.object({ valuations: z.array(valuationSchema) });

const outputSchema = {
  type: 'object',
  properties: {
    valuations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          playerId: { type: 'string' },
          p10: { type: 'number' },
          p50: { type: 'number' },
          p90: { type: 'number' },
          replacementValue: { type: 'number' },
          adp: { type: ['number', 'null'] },
          tier: { type: 'number' },
          byeWeek: { type: ['number', 'null'] },
          injuryRisk: { type: 'number' },
          breakoutScore: { type: 'number' },
          bustRisk: { type: 'number' },
          identityConfidence: { type: 'number' },
          rationale: { type: 'string' },
          sourceUrls: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'playerId',
          'p10',
          'p50',
          'p90',
          'replacementValue',
          'adp',
          'tier',
          'byeWeek',
          'injuryRisk',
          'breakoutScore',
          'bustRisk',
          'identityConfidence',
          'rationale',
          'sourceUrls',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['valuations'],
  additionalProperties: false,
} as const;

type DecisionCodexClient = Pick<
  CodexAppServerClient,
  'readiness' | 'startDecisionThread' | 'runStructuredTurn'
>;

export type PlayerValueCandidate = {
  playerId: string;
  name: string;
  position: Position;
  nflTeam: string | null;
};

export type PlayerValueHorizon = 'next_scoring_period' | 'rest_of_season' | 'draft_season';

export type PlayerValueRequest = {
  teamName: string;
  season: number;
  horizon: PlayerValueHorizon;
  players: PlayerValueCandidate[];
  rules: LeagueRuleSetV1;
  strategy: StrategyProfileV1;
  news: NewsItem[];
};

export type ValuedDecisionPlayer = DecisionPlayer & {
  rationale: string;
  sourceUrls: string[];
};

export interface PlayerValueProvider {
  valuePlayers(request: PlayerValueRequest): Promise<ValuedDecisionPlayer[]>;
}

export type CodexPlayerValueOptions = {
  chunkSize?: number;
  now?: () => Date;
};

function uniqueCandidates(players: PlayerValueCandidate[]): PlayerValueCandidate[] {
  const byId = new Map<string, PlayerValueCandidate>();
  for (const player of players) {
    if (byId.has(player.playerId)) throw new Error(`Duplicate player ID: ${player.playerId}`);
    byId.set(player.playerId, player);
  }
  return [...byId.values()];
}

function newsForPrompt(
  news: NewsItem[],
): Array<Pick<NewsItem, 'title' | 'summary' | 'source' | 'url' | 'publishedAt'>> {
  return news.slice(0, 80).map(({ title, summary, source, url, publishedAt }) => ({
    title,
    summary,
    source,
    url,
    publishedAt,
  }));
}

export class CodexPlayerValueService implements PlayerValueProvider {
  readonly #chunkSize: number;
  readonly #now: () => Date;

  constructor(
    readonly client: DecisionCodexClient,
    readonly workspaceRoot: string,
    options: CodexPlayerValueOptions = {},
  ) {
    this.#chunkSize = options.chunkSize ?? 40;
    if (!Number.isInteger(this.#chunkSize) || this.#chunkSize < 1 || this.#chunkSize > 100) {
      throw new Error('Codex valuation chunk size must be between 1 and 100');
    }
    this.#now = options.now ?? (() => new Date());
  }

  async valuePlayers(request: PlayerValueRequest): Promise<ValuedDecisionPlayer[]> {
    const players = uniqueCandidates(request.players);
    if (players.length === 0) return [];
    const readiness = await this.client.readiness(this.workspaceRoot);
    if (!readiness.readyForDecisions) {
      throw new Error(`CODEX_DECISIONS_UNAVAILABLE: ${readiness.issues.join('; ')}`);
    }
    const thread = await this.client.startDecisionThread({
      cwd: this.workspaceRoot,
      ephemeral: true,
      baseInstructions: [
        'Research fantasy-football player value using read-only local data and public web sources.',
        'Use the fantasy-football-sentiment skill when it is available.',
        'Treat the supplied ESPN player IDs, rules, strategy, and news as the only team-state facts.',
        'Never operate ESPN, use private endpoints, mutate files, or propose an account action.',
        'Return calibrated estimates with source URLs actually consulted; distinguish uncertainty from fact.',
      ].join('\n'),
    });

    const results: ValuedDecisionPlayer[] = [];
    for (let offset = 0; offset < players.length; offset += this.#chunkSize) {
      const chunk = players.slice(offset, offset + this.#chunkSize);
      const expectedIds = new Set(chunk.map((player) => player.playerId));
      const response = await this.client.runStructuredTurn({
        threadId: thread.threadId,
        prompt: [
          `As of ${this.#now().toISOString()}, value every supplied player for ${request.teamName}'s ${request.season} season.`,
          `Projection horizon: ${request.horizon}. All point estimates must use the supplied league scoring.`,
          'p10, p50, and p90 are fantasy-point outcomes for that exact horizon. replacementValue is the same-horizon positional replacement baseline.',
          'ADP may be null outside draft context. injuryRisk, breakoutScore, bustRisk, and identityConfidence are calibrated 0-1 values.',
          'Return exactly one valuation for every supplied playerId, with no extra IDs and at least one real public source URL per player.',
          `ACTIVE_RULES=${JSON.stringify(request.rules)}`,
          `STRATEGY=${JSON.stringify(request.strategy)}`,
          `CURRENT_NEWS=${JSON.stringify(newsForPrompt(request.news))}`,
          `PLAYERS=${JSON.stringify(chunk)}`,
          'The reproducible nflverse cache, when seeded, is under data/cache/nflverse and may be inspected read-only.',
        ].join('\n'),
        outputSchema: outputSchema as unknown as JsonValue,
        parse: (value) => responseSchema.parse(value),
        timeoutMs: 300_000,
      });
      const seen = new Set<string>();
      for (const valuation of response.valuations) {
        if (!expectedIds.has(valuation.playerId)) {
          throw new Error(`Codex returned unexpected player ID: ${valuation.playerId}`);
        }
        if (seen.has(valuation.playerId)) {
          throw new Error(`Codex returned duplicate player ID: ${valuation.playerId}`);
        }
        seen.add(valuation.playerId);
      }
      const missing = [...expectedIds].filter((playerId) => !seen.has(playerId));
      if (missing.length > 0) {
        throw new Error(`Codex omitted player IDs: ${missing.join(', ')}`);
      }
      const candidatesById = new Map(chunk.map((player) => [player.playerId, player]));
      results.push(
        ...response.valuations.map((valuation) => {
          const candidate = candidatesById.get(valuation.playerId);
          if (!candidate) throw new Error('Validated valuation lost its input player');
          return {
            ...candidate,
            byeWeek: valuation.byeWeek,
            p10: valuation.p10,
            p50: valuation.p50,
            p90: valuation.p90,
            replacementValue: valuation.replacementValue,
            adp: valuation.adp,
            tier: valuation.tier,
            injuryRisk: valuation.injuryRisk,
            breakoutScore: valuation.breakoutScore,
            bustRisk: valuation.bustRisk,
            mappingConfidence: valuation.identityConfidence,
            rationale: valuation.rationale,
            sourceUrls: valuation.sourceUrls,
          };
        }),
      );
    }
    return results;
  }
}
