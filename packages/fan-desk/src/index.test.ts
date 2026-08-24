import { randomUUID } from 'node:crypto';

import type { FanDeskProfileV1, TeamConfigV1 } from '@ai-ff/domain';
import { describe, expect, it } from 'vitest';

import { createFanPost, createFanPostDraft, type FanPortalSnapshot } from './index.js';

const now = new Date('2026-08-23T18:00:00.000Z');
const team: TeamConfigV1 = {
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
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const profile: FanDeskProfileV1 = {
  schemaVersion: 1,
  id: randomUUID(),
  teamId: team.id,
  name: 'The Stands',
  voice: 'contrarian',
  heat: 0.8,
  rumorTolerance: 0.7,
  cadence: 'every_3_hours',
  enabled: true,
  emailEnabled: false,
  emailAddress: null,
  emailSubjectPrefix: 'Fourth and Goal // Fan Desk',
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const snapshot = (id: string, roster: string[]): FanPortalSnapshot => ({
  id,
  digest: id.repeat(64).slice(0, 64),
  observedAt: now.toISOString(),
  page: 'clubhouse',
  roster: roster.map((name) => ({
    playerId: name,
    name,
    position: 'WR',
    nflTeam: 'NYJ',
    availability: 'active',
    slot: 'WR',
  })),
  availablePlayers: [
    {
      playerId: 'waiver-1',
      name: 'Breakout Candidate',
      position: 'RB',
      nflTeam: 'SEA',
      availability: 'active',
      acquisitionType: 'waiver',
      rosteredPercent: 42,
    },
  ],
  leagueTeams: [
    { teamId: 'team-7', name: team.name, roster: [] },
    { teamId: 'team-8', name: 'Rival FC', roster: [] },
    { teamId: 'team-9', name: 'Spreadsheet Kings', roster: [] },
  ],
  waiverClaims: [],
  tradeOffers: [],
  faabRemaining: 72,
});

describe('fan desk', () => {
  it('turns a computer-use roster delta into an evidence-backed hot take', () => {
    const draft = createFanPostDraft({
      team,
      profile,
      latest: snapshot('b', ['A', 'B', 'C']),
      previous: snapshot('a', ['A', 'B']),
      news: [],
      now,
    });
    expect(draft.kind).toBe('waiver_wire');
    expect(draft.body).toContain('Roster movement');
    expect(draft.evidence[0]?.sourceType).toBe('espn_scan');
    expect(draft.stance).toContain('popular take is wrong');
  });

  it('uses fresh news as the lead signal and can accept a Codex voice writer', async () => {
    const post = await createFanPost(
      {
        team,
        profile,
        latest: snapshot('b', ['A', 'B']),
        previous: null,
        news: [
          {
            title: 'Star player questionable',
            source: 'ESPN NFL Headlines',
            url: 'https://example.com/a',
            publishedAt: now.toISOString(),
          },
        ],
        now,
      },
      async ({ seed }) => ({
        headline: 'BREAKING: THE GROUP CHAT IS MELTING',
        dek: seed.dek,
        body: `${seed.body}\n\nSource the receipts.`,
        stance: 'The timeline is undefeated.',
      }),
    );
    expect(post.generatedBy).toBe('codex');
    expect(post.headline).toContain('GROUP CHAT');
    expect(post.evidence).toHaveLength(2);
  });
});
