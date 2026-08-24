import { openDatabase, PortalSnapshotRepository, TeamRepository } from '@ai-ff/db';
import type { TeamConfigV1 } from '@ai-ff/domain';
import { SimulatedEspnPortal, type EspnPortalSnapshot } from '@ai-ff/espn';
import { afterEach, describe, expect, it } from 'vitest';

import { EspnSnapshotService, portalSnapshotDigest } from './espn-snapshot-service.js';

const databases: ReturnType<typeof openDatabase>[] = [];
const now = '2026-08-23T18:00:00.000Z';

function team(): TeamConfigV1 {
  return {
    schemaVersion: 1,
    id: '27a1c2ea-c3a5-41aa-9d9d-5a068e5d0ce4',
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

function snapshotFixture(): EspnPortalSnapshot {
  return {
    signedIn: true,
    leagueId: 'league-1',
    teamId: 'team-7',
    page: 'clubhouse',
    roster: [
      {
        playerId: 'starter-rb',
        name: 'Starter Runner',
        position: 'RB',
        nflTeam: 'NYJ',
        availability: 'active',
        slot: 'RB',
        locked: false,
      },
    ],
    availablePlayers: [],
    leagueTeams: [],
    faabRemaining: 100,
    faabSpentThisWeek: 0,
    waiverClaims: [],
    tradeOffers: [],
    draft: { status: 'pre_draft', onClockTeamId: null, draftSlot: 7, picks: [] },
    observedAt: now,
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('ESPN snapshot service', () => {
  it('persists and independently verifies an exact team-bound observation', async () => {
    const database = openDatabase();
    databases.push(database);
    const configuredTeam = new TeamRepository(database.db).create(team());
    const snapshot = snapshotFixture();
    const service = new EspnSnapshotService(
      new PortalSnapshotRepository(database.db),
      new SimulatedEspnPortal(snapshot, () => now),
      () => new Date(now),
    );

    const synced = await service.sync(configuredTeam);

    expect(synced.digest).toBe(portalSnapshotDigest(snapshot));
    expect(synced.snapshot.roster).toEqual(snapshot.roster);
    expect(service.latest(configuredTeam.id)).toEqual(synced);
  });

  it('fails closed if Computer Use observes a different league or signed-out state', async () => {
    const database = openDatabase();
    databases.push(database);
    const configuredTeam = new TeamRepository(database.db).create(team());
    const repository = new PortalSnapshotRepository(database.db);
    const wrongLeague = new EspnSnapshotService(
      repository,
      new SimulatedEspnPortal({ ...snapshotFixture(), leagueId: 'other-league' }, () => now),
      () => new Date(now),
    );
    await expect(wrongLeague.sync(configuredTeam)).rejects.toThrow('ESPN_BINDING_MISMATCH');

    const signedOut = new EspnSnapshotService(
      repository,
      new SimulatedEspnPortal({ ...snapshotFixture(), signedIn: false }, () => now),
      () => new Date(now),
    );
    await expect(signedOut.sync(configuredTeam)).rejects.toThrow('ESPN_AUTH_REQUIRED');
    expect(repository.latestForTeam(configuredTeam.id)).toBeNull();
  });
});
