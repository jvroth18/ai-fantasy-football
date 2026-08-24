import { randomUUID } from 'node:crypto';

import { openDatabase, RuleSetRepository, TeamRepository, type DatabaseHandle } from '@ai-ff/db';
import type { LeagueRuleSetV1, TeamConfigV1 } from '@ai-ff/domain';
import type { RuleSource } from '@ai-ff/rules';
import { afterEach, describe, expect, it } from 'vitest';

import { RuleImportService, type CodexRuleExtractor } from './rule-import-service.js';

const now = '2026-08-23T18:00:00.000Z';
const handles: DatabaseHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

function teamFixture(): TeamConfigV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
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

function rulesFixture(teamId: string = randomUUID()): LeagueRuleSetV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    name: 'PPR',
    season: 2025,
    platform: 'espn',
    status: 'active',
    revision: 99,
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
    roster: [{ slot: 'QB', count: 1, starter: true, eligiblePositions: ['QB'] }],
    draft: { type: 'snake', teamCount: 12, rounds: 15, secondsPerPick: 90, auctionBudget: null },
    waivers: {
      type: 'faab',
      budget: 100,
      minimumBid: 0,
      processingDays: [3],
      processingTimeLocal: '03:00',
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
      deadlineWeek: 12,
      reviewType: 'league_vote',
      reviewHours: 24,
      futureDraftPicksAllowed: false,
    },
    evidence: [],
    createdAt: now,
  };
}

function setup(extractor: CodexRuleExtractor | null = null) {
  const handle = openDatabase();
  handles.push(handle);
  const teams = new TeamRepository(handle.db);
  const rules = new RuleSetRepository(handle.db);
  const team = teams.create(teamFixture());
  const service = new RuleImportService(teams, rules, extractor, () => new Date(now));
  return { teams, rules, team, service };
}

function source(name: string, mimeType: RuleSource['mimeType'], content: string): RuleSource {
  return { name, mimeType, bytes: new TextEncoder().encode(content), observedAt: now };
}

describe('RuleImportService', () => {
  it('normalizes a full JSON upload into a new team-owned draft revision', async () => {
    const { rules, team, service } = setup();
    const result = await service.import(
      team.id,
      source('rules.json', 'application/json', JSON.stringify(rulesFixture())),
    );

    expect(result).toMatchObject({ extraction: 'deterministic_json', conflictsWithActive: [] });
    expect(result.ruleSet).toMatchObject({
      teamId: team.id,
      season: team.season,
      status: 'draft',
      revision: 1,
    });
    expect(rules.listForTeam(team.id)).toHaveLength(1);
  });

  it('applies a scoring CSV as a reviewable revision over the active full mechanics', async () => {
    const { rules, teams, team, service } = setup();
    const active = { ...rulesFixture(team.id), revision: 1 };
    rules.create(active);
    teams.activateRuleSet(team.id, active.id, now);

    const result = await service.import(
      team.id,
      source(
        'scoring.csv',
        'text/csv',
        'stat,label,pointsPerUnit,unitSize\nreceptions,Receptions,0.5,1',
      ),
    );

    expect(result.ruleSet.revision).toBe(2);
    expect(result.ruleSet.roster).toEqual(active.roster);
    expect(
      result.conflictsWithActive.some((conflict) => conflict.pointer.endsWith('pointsPerUnit')),
    ).toBe(true);
  });

  it('routes image and PDF-like sources through the injected Codex extractor', async () => {
    const extractor: CodexRuleExtractor = {
      extract: async () => rulesFixture(),
    };
    const { team, service } = setup(extractor);
    const result = await service.import(
      team.id,
      source('settings.txt', 'text/plain', 'One quarterback, PPR scoring'),
    );

    expect(result.extraction).toBe('codex');
    expect(result.ruleSet.evidence.at(-1)?.confidence).toBe(0.8);
  });

  it('requires a complete base before importing scoring-only CSV', async () => {
    const { team, service } = setup();
    await expect(
      service.import(
        team.id,
        source(
          'scoring.csv',
          'text/csv',
          'stat,label,pointsPerUnit,unitSize\nreceptions,Receptions,1,1',
        ),
      ),
    ).rejects.toThrow('requires an existing full rule set');
  });
});
