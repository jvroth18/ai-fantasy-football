import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CodexAppServerClient, StructuredTurnRequest } from '@ai-ff/codex';
import type { TeamConfigV1 } from '@ai-ff/domain';
import type { RuleSource } from '@ai-ff/rules';
import { afterEach, describe, expect, it } from 'vitest';

import { CodexRuleExtractorService } from './codex-rule-extractor.js';

const temporaryRoots: string[] = [];
const now = '2026-08-23T18:00:00.000Z';

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function teamFixture(): TeamConfigV1 {
  return {
    schemaVersion: 1,
    id: '29c1dd33-374c-4df5-9036-4775dc77c532',
    name: 'Fourth and Goal',
    platform: 'espn',
    season: 2026,
    timeZone: 'America/New_York',
    color: '#b9f55b',
    espnLeagueId: 'league-1',
    espnTeamId: 'team-7',
    activeRuleSetId: null,
    strategyProfileId: null,
    automation: {
      armed: false,
      lineupChanges: false,
      waiverClaims: false,
      freeAgentMoves: false,
      draftPicks: false,
      outgoingTradeOffers: false,
      incomingTradeAccepts: false,
      maxFaabPerClaim: null,
      maxFaabPerWeek: null,
      minimumFaabReserve: 0,
      maximumDraftReach: 24,
      minimumDataFreshnessMinutes: 180,
    },
    createdAt: now,
    updatedAt: now,
  };
}

const extractedRules = {
  schemaVersion: 1 as const,
  id: '93dcbacd-d83c-47a7-a109-bd40ea10b0c2',
  teamId: '29c1dd33-374c-4df5-9036-4775dc77c532',
  name: 'Extracted PPR',
  season: 2026,
  platform: 'espn' as const,
  status: 'draft' as const,
  revision: 1,
  scoring: [
    {
      stat: 'receptions',
      label: 'Receptions',
      pointsPerUnit: 1,
      unitSize: 1,
      bonuses: [],
      evidence: [],
    },
  ],
  roster: [{ slot: 'QB' as const, count: 1, starter: true, eligiblePositions: ['QB' as const] }],
  draft: {
    type: 'snake' as const,
    teamCount: 12,
    rounds: 15,
    secondsPerPick: 90,
    auctionBudget: null,
  },
  waivers: {
    type: 'faab' as const,
    budget: 100,
    minimumBid: 0,
    processingDays: [3],
    processingTimeLocal: '03:00',
    freeAgentMode: 'first_come' as const,
    maxAcquisitionsPerWeek: null,
    tiebreaker: 'bid_timestamp' as const,
  },
  lineup: { lockType: 'player_game_time' as const, allowBenchEditsAfterLock: true },
  playoffs: {
    teams: 6,
    startWeek: 15,
    championshipWeek: 17,
    twoWeekMatchups: false,
    reseed: false,
  },
  trades: {
    deadlineWeek: 12,
    reviewType: 'league_vote' as const,
    reviewHours: 24,
    futureDraftPicksAllowed: false,
  },
  evidence: [],
  createdAt: now,
};

describe('CodexRuleExtractorService', () => {
  it('keeps text inline and runs a schema-constrained read-only extraction turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-ff-rules-'));
    temporaryRoots.push(root);
    const requests: StructuredTurnRequest<unknown>[] = [];
    const client = {
      startDecisionThread: async () => ({ threadId: 'thread-1', model: 'codex' }),
      async runStructuredTurn<T>(request: StructuredTurnRequest<T>): Promise<T> {
        requests.push(request as StructuredTurnRequest<unknown>);
        return request.parse(extractedRules);
      },
    } as unknown as CodexAppServerClient;
    const service = new CodexRuleExtractorService(client, root, join(root, 'var', 'uploads'));
    const source: RuleSource = {
      name: 'settings.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('One quarterback and full PPR scoring.'),
      observedAt: now,
    };

    const result = await service.extract(source, teamFixture());

    expect(result.name).toBe('Extracted PPR');
    expect(requests[0]?.prompt).toContain('One quarterback and full PPR scoring.');
    expect(requests[0]?.timeoutMs).toBe(300_000);
  });

  it('uses a private temporary local file for binary sources and deletes it afterward', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-ff-rules-'));
    temporaryRoots.push(root);
    let observedPath = '';
    const client = {
      startDecisionThread: async () => ({ threadId: 'thread-1', model: 'codex' }),
      async runStructuredTurn<T>(request: StructuredTurnRequest<T>): Promise<T> {
        const match = /Read the local source at (.+?\.pdf)\./.exec(request.prompt);
        observedPath = match?.[1] ?? '';
        if (observedPath) await access(observedPath);
        return request.parse(extractedRules);
      },
    } as unknown as CodexAppServerClient;
    const service = new CodexRuleExtractorService(client, root, join(root, 'var', 'uploads'));
    const source: RuleSource = {
      name: 'settings.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
      observedAt: now,
    };

    await service.extract(source, teamFixture());

    expect(observedPath).toContain(join(root, 'var', 'uploads'));
    await expect(access(observedPath)).rejects.toThrow();
  });
});
