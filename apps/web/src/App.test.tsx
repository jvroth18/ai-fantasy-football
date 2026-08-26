import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { Bootstrap, Team, TeamDetail } from './types.js';

const now = '2026-08-23T18:00:00.000Z';

function team(): Team {
  return {
    schemaVersion: 1,
    id: 'd27ad1c7-5691-4ffd-809f-f46c128f59ac',
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

function bootstrap(teams: Team[] = []): Bootstrap {
  return {
    teams,
    schedules: [],
    codex: {
      authenticated: true,
      accountKind: 'chatgpt',
      modelCount: 7,
      skillCount: 19,
      defaultModel: 'gpt-test',
      computerUseAvailable: true,
      readyForDecisions: true,
      readyForEspn: true,
      issues: [],
    },
    data: { sleeper: null, nflverse: null, rss: null },
  };
}

function detail(configuredTeam = team()): TeamDetail {
  return {
    team: configuredTeam,
    rules: [],
    strategy: null,
    espnSnapshot: null,
    recommendations: [],
    runs: [],
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('application shell', () => {
  it('guides first-run team creation from live bootstrap state', async () => {
    const fetch = vi.fn(async () => response(bootstrap()));
    vi.stubGlobal('fetch', fetch);

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Connect your fantasy league.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect league/ })).toBeInTheDocument();
    expect(screen.getByText(/starts local, independent/)).toBeInTheDocument();
  });

  it('loads the distilled league experience and keeps advanced tools archived', async () => {
    const configuredTeam = team();
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url === '/api/bootstrap'
        ? response(bootstrap([configuredTeam]))
        : response(detail(configuredTeam));
    });
    vi.stubGlobal('fetch', fetch);

    render(<App />);

    expect(await screen.findByRole('heading', { name: configuredTeam.name })).toBeInTheDocument();
    expect(screen.getByLabelText('ACTIVE TEAM')).toHaveValue(configuredTeam.id);
    expect(screen.getByRole('button', { name: 'AI setup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Members' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: /League rules/ }));
    expect(screen.getByRole('heading', { name: 'Rules laboratory' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: /Trade desk/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Trade desk' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AI setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose personality' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Fan desk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate bulletin/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: /Agent network/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Agent network' })).toBeInTheDocument();
  });

  it('supports durable feed reactions and inline comments for the active member', async () => {
    const configuredTeam = team();
    const owner = {
      id: '3d92e4c7-6637-4f7a-a07f-9bbb61e6bc31',
      teamId: configuredTeam.id,
      displayName: 'Commissioner',
      role: 'owner' as const,
      joinedAt: now,
    };
    const post = {
      id: 'd3898e10-7581-4dc2-9582-b14726f203eb',
      teamId: configuredTeam.id,
      memberId: owner.id,
      authorName: owner.displayName,
      body: 'Waiver night starts now.',
      createdAt: now,
    };
    const teamDetail: TeamDetail = {
      ...detail(configuredTeam),
      members: [owner],
      leaguePosts: [post],
      leagueReactions: [],
      leagueComments: [],
      news: [],
      newsUpdatedAt: null,
    };
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/bootstrap') return response(bootstrap([configuredTeam]));
      if (init?.method === 'POST') return response({ active: true });
      return response(teamDetail);
    });
    vi.stubGlobal('fetch', fetch);

    render(<App />);
    expect(await screen.findByText(post.body)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/teams/${configuredTeam.id}/reactions/toggle`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    fireEvent.change(screen.getByLabelText('Write a comment'), {
      target: { value: 'Ready.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/teams/${configuredTeam.id}/comments`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('keeps the automation save gate disabled until the exact arming phrase is typed', async () => {
    const configuredTeam = team();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/bootstrap'
          ? response(bootstrap([configuredTeam]))
          : response(detail(configuredTeam)),
      ),
    );
    render(<App />);
    await screen.findByRole('heading', { name: configuredTeam.name });

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: /Automation/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Arm ESPN actions' }));
    const save = screen.getByRole('button', { name: /Save safety policy/ });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type ARM ESPN AUTOMATION/), {
      target: { value: 'ARM ESPN AUTOMATION' },
    });
    expect(save).toBeEnabled();
    expect(screen.getByText(/Incoming trade acceptance/)).toBeInTheDocument();
    expect(screen.getByText(/Permanently manual/)).toBeInTheDocument();
  });

  it('creates a team through the daemon and enters its workspace', async () => {
    const configuredTeam = team();
    let created = false;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/teams' && init?.method === 'POST') {
        created = true;
        return response(configuredTeam, 201);
      }
      if (url === '/api/bootstrap') return response(bootstrap(created ? [configuredTeam] : []));
      if (url === `/api/teams/${configuredTeam.id}`) return response(detail(configuredTeam));
      return response({ error: 'NOT_FOUND' }, 404);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await screen.findByRole('heading', { name: 'Connect your fantasy league.' });

    fireEvent.change(screen.getByLabelText('Team name'), {
      target: { value: configuredTeam.name },
    });
    fireEvent.change(screen.getByPlaceholderText('https://fantasy.espn.com/...'), {
      target: {
        value: `https://fantasy.espn.com/football/team?leagueId=${configuredTeam.espnLeagueId}&teamId=${configuredTeam.espnTeamId}`,
      },
    });
    expect(screen.getByText('ESPN league found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Connect league/ }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/teams', expect.objectContaining({ method: 'POST' })),
    );
    expect(
      await screen.findByRole('heading', { name: 'Set up your league AI' }),
    ).toBeInTheDocument();
  });

  it('requires a visible confirmation before executing an armed recommendation', async () => {
    const configuredTeam: Team = {
      ...team(),
      automation: { ...team().automation, armed: true, lineupChanges: true },
    };
    const teamDetail: TeamDetail = {
      ...detail(configuredTeam),
      recommendations: [
        {
          id: '17af5374-13fb-44af-b1c9-eb1fa5a99e70',
          type: 'lineup',
          title: 'Start Breakout Runner',
          rationale: 'The weekly projection is materially higher.',
          projectedPointDelta: 4.8,
          projectedWinProbabilityDelta: null,
          risk: 0.2,
          confidence: 0.91,
          action: {
            type: 'lineup_change',
            payload: {
              playerInId: 'bench-rb',
              playerOutId: 'starter-rb',
              targetSlot: 'RB',
            },
          },
          createdAt: now,
          expiresAt: '2026-08-24T18:00:00.000Z',
        },
      ],
    };
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/bootstrap') return response(bootstrap([configuredTeam]));
      if (url === `/api/teams/${configuredTeam.id}`) return response(teamDetail);
      if (
        url ===
          `/api/teams/${configuredTeam.id}/recommendations/${teamDetail.recommendations[0]?.id}/execute` &&
        init?.method === 'POST'
      ) {
        return response({
          outcome: 'verified',
          performed: true,
          replayed: false,
          evidence: ['Post-action observation matched the exact intent'],
          errorCode: null,
        });
      }
      return response({ error: 'NOT_FOUND' }, 404);
    });
    vi.stubGlobal('fetch', fetch);
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: /Manager dashboard/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Execute on ESPN' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Start Breakout Runner'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/teams/${configuredTeam.id}/recommendations/${teamDetail.recommendations[0]?.id}/execute`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(await screen.findByText('ESPN action verified by read-back')).toBeInTheDocument();
  });
});
