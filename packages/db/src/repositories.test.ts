import { randomUUID } from 'node:crypto';

import type { LeagueRuleSetV1, TeamConfigV1 } from '@ai-ff/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type DatabaseHandle } from './database.js';
import { RuleSetRepository, TeamRepository } from './repositories.js';

const now = '2026-08-23T12:00:00.000Z';
const databases: DatabaseHandle[] = [];

function makeTeam(name: string, leagueId: string): TeamConfigV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    name,
    platform: 'espn',
    season: 2026,
    timeZone: 'America/New_York',
    color: '#b9f55b',
    espnLeagueId: leagueId,
    espnTeamId: '1',
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

function makeRules(teamId: string, revision = 1): LeagueRuleSetV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId,
    name: `Rules v${revision}`,
    season: 2026,
    platform: 'espn',
    status: 'draft',
    revision,
    scoring: [
      {
        stat: 'passing_yards',
        label: 'Passing yards',
        pointsPerUnit: 1,
        unitSize: 25,
        bonuses: [],
        evidence: [],
      },
    ],
    roster: [{ slot: 'QB', count: 1, starter: true, eligiblePositions: ['QB'] }],
    draft: { type: 'snake', teamCount: 12, rounds: 16, secondsPerPick: 90, auctionBudget: null },
    waivers: {
      type: 'rolling',
      budget: null,
      minimumBid: 0,
      processingDays: [3],
      processingTimeLocal: '03:00',
      freeAgentMode: 'first_come',
      maxAcquisitionsPerWeek: null,
      tiebreaker: 'rolling_order',
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
      reviewType: 'none',
      reviewHours: 0,
      futureDraftPicksAllowed: false,
    },
    evidence: [],
    createdAt: now,
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('team-scoped persistence', () => {
  it('keeps rule versions isolated between independent teams', () => {
    const handle = openDatabase();
    databases.push(handle);
    const teams = new TeamRepository(handle.db);
    const rules = new RuleSetRepository(handle.db);
    const alpha = teams.create(makeTeam('Alpha', 'league-alpha'));
    const bravo = teams.create(makeTeam('Bravo', 'league-bravo'));
    const alphaRules = rules.create(makeRules(alpha.id));
    rules.create(makeRules(bravo.id));

    expect(rules.listForTeam(alpha.id)).toEqual([alphaRules]);
    expect(rules.getForTeam(bravo.id, alphaRules.id)).toBeNull();
    expect(() => teams.activateRuleSet(bravo.id, alphaRules.id, now)).toThrow(
      'Rule set does not belong to team',
    );
  });

  it('activates one immutable rules version and retires the previous version', () => {
    const handle = openDatabase();
    databases.push(handle);
    const teams = new TeamRepository(handle.db);
    const rules = new RuleSetRepository(handle.db);
    const team = teams.create(makeTeam('Alpha', 'league-alpha'));
    const first = rules.create(makeRules(team.id, 1));
    const second = rules.create(makeRules(team.id, 2));

    teams.activateRuleSet(team.id, first.id, now);
    expect(rules.getForTeam(team.id, first.id)?.status).toBe('active');
    const activated = teams.activateRuleSet(team.id, second.id, '2026-08-24T12:00:00.000Z');

    expect(activated.activeRuleSetId).toBe(second.id);
    expect(rules.getForTeam(team.id, first.id)?.status).toBe('retired');
    expect(rules.getForTeam(team.id, second.id)?.status).toBe('active');
    const statuses = handle.raw
      .prepare('SELECT id, status FROM league_rule_sets WHERE team_id = ? ORDER BY revision')
      .all(team.id) as { id: string; status: string }[];
    expect(statuses).toEqual([
      { id: first.id, status: 'retired' },
      { id: second.id, status: 'active' },
    ]);
  });
});
