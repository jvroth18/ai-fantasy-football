import type { CodexAppServerClient } from '@ai-ff/codex';
import type { LeagueRuleSetV1, StrategyProfileV1 } from '@ai-ff/domain';
import { describe, expect, it, vi } from 'vitest';

import { CodexPlayerValueService, type PlayerValueRequest } from './codex-player-values.js';

const now = '2026-08-23T18:00:00.000Z';

function requestFixture(): PlayerValueRequest {
  return {
    teamName: 'Fourth and Goal',
    season: 2026,
    horizon: 'next_scoring_period',
    players: [
      { playerId: 'espn-1', name: 'Example Runner', position: 'RB', nflTeam: 'BUF' },
      { playerId: 'espn-2', name: 'Example Receiver', position: 'WR', nflTeam: 'GB' },
    ],
    rules: {
      schemaVersion: 1,
      id: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
      name: 'PPR',
      season: 2026,
      platform: 'espn',
      status: 'active',
      revision: 1,
      scoring: [
        {
          stat: 'receiving_receptions',
          label: 'Reception',
          pointsPerUnit: 1,
          unitSize: 1,
          bonuses: [],
          evidence: [],
        },
      ],
      roster: [{ slot: 'FLEX', count: 1, starter: true, eligiblePositions: ['RB', 'WR'] }],
      draft: {
        type: 'snake',
        teamCount: 12,
        rounds: 15,
        secondsPerPick: 90,
        auctionBudget: null,
      },
      waivers: {
        type: 'faab',
        budget: 100,
        minimumBid: 0,
        processingDays: [3],
        processingTimeLocal: '11:00',
        freeAgentMode: 'first_come',
        maxAcquisitionsPerWeek: null,
        tiebreaker: 'bid_timestamp',
      },
      lineup: { lockType: 'player_game_time', allowBenchEditsAfterLock: true },
      playoffs: {
        teams: 6,
        startWeek: 15,
        championshipWeek: 17,
        twoWeekMatchups: false,
        reseed: false,
      },
      trades: {
        deadlineWeek: 11,
        reviewType: 'league_vote',
        reviewHours: 24,
        futureDraftPicksAllowed: false,
      },
      evidence: [],
      createdAt: now,
    } satisfies LeagueRuleSetV1,
    strategy: {
      schemaVersion: 1,
      id: '33333333-3333-4333-8333-333333333333',
      teamId: '22222222-2222-4222-8222-222222222222',
      name: 'Balanced',
      riskTolerance: 0.5,
      faabAggressiveness: 0.5,
      benchChurn: 0.5,
      preferStacks: false,
      preferHandcuffs: false,
      positionWeights: {},
      protectedPlayerIds: [],
      blockedPlayerIds: [],
      targetPlayerIds: [],
      maximumTradeOffersPerOpponentPerWeek: 1,
      createdAt: now,
      updatedAt: now,
    } satisfies StrategyProfileV1,
    news: [],
  };
}

function valuation(playerId: string) {
  return {
    playerId,
    p10: 8,
    p50: 14,
    p90: 22,
    replacementValue: 9,
    adp: 42,
    tier: 3,
    byeWeek: 7,
    injuryRisk: 0.15,
    breakoutScore: 0.7,
    bustRisk: 0.2,
    identityConfidence: 0.98,
    rationale: 'Strong role and efficient recent usage.',
    sourceUrls: ['https://example.com/rankings'],
  };
}

function clientReturning(valuations: ReturnType<typeof valuation>[]) {
  return {
    readiness: vi.fn(async () => ({ readyForDecisions: true, issues: [] })),
    startDecisionThread: vi.fn(async () => ({ threadId: 'thread-1', model: 'test' })),
    runStructuredTurn: vi.fn(async (input: { parse: (value: unknown) => unknown }) =>
      input.parse({ valuations }),
    ),
  } as unknown as Pick<
    CodexAppServerClient,
    'readiness' | 'startDecisionThread' | 'runStructuredTurn'
  >;
}

describe('CodexPlayerValueService', () => {
  it('returns a complete exact-ID valuation set in bounded chunks', async () => {
    const request = requestFixture();
    const client = clientReturning(request.players.map((player) => valuation(player.playerId)));
    const service = new CodexPlayerValueService(client, '/workspace', {
      chunkSize: 10,
      now: () => new Date(now),
    });

    const players = await service.valuePlayers(request);

    expect(players.map((player) => player.playerId)).toEqual(['espn-1', 'espn-2']);
    expect(players[0]).toMatchObject({ name: 'Example Runner', p50: 14, mappingConfidence: 0.98 });
    expect(client.startDecisionThread).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
    expect(client.runStructuredTurn).toHaveBeenCalledOnce();
  });

  it('fails closed when Codex omits or invents a player ID', async () => {
    const request = requestFixture();
    const client = clientReturning([valuation('espn-1'), valuation('invented')]);
    const service = new CodexPlayerValueService(client, '/workspace');

    await expect(service.valuePlayers(request)).rejects.toThrow('unexpected player ID');
  });
});
