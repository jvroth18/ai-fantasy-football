import { randomUUID } from 'node:crypto';

import {
  AutomationRunRepository,
  JobLeaseRepository,
  openDatabase,
  TeamRepository,
} from '@ai-ff/db';
import type { TeamConfigV1 } from '@ai-ff/domain';

import { DurableJobRunner } from './runner.js';
import type { JobDefinition } from './types.js';

export const schedulerNow = '2026-08-23T18:00:00.000Z';

export function teamFixture(espnTeamId = '1'): TeamConfigV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    name: `Team ${espnTeamId}`,
    platform: 'espn',
    season: 2026,
    timeZone: 'America/New_York',
    color: '#b9f55b',
    espnLeagueId: 'league-1',
    espnTeamId,
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
    createdAt: schedulerNow,
    updatedAt: schedulerNow,
  };
}

export function definitionFixture(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    jobType: 'daily_manager',
    description: 'Test daily manager',
    cron: '0 7 * * *',
    leaseMinutes: 15,
    catchUpAfterMinutes: 1_500,
    handler: async () => ({ status: 'verified' }),
    ...overrides,
  };
}

export function schedulerFixture() {
  const handle = openDatabase();
  const teams = new TeamRepository(handle.db);
  const runs = new AutomationRunRepository(handle.db);
  const leases = new JobLeaseRepository(handle.db);
  const runner = new DurableJobRunner(runs, leases, {
    now: () => new Date(schedulerNow),
    ownerId: 'test-runner',
  });
  return { handle, teams, runs, leases, runner };
}
