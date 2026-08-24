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
      await screen.findByRole('heading', { name: 'Build your first front office.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create team/ })).toBeInTheDocument();
    expect(screen.getByText(/starts local, independent/)).toBeInTheDocument();
  });

  it('loads an independent team command center and all action workspaces', async () => {
    const configuredTeam = team();
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url === '/api/bootstrap'
        ? response(bootstrap([configuredTeam]))
        : response(detail(configuredTeam));
    });
    vi.stubGlobal('fetch', fetch);

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Finish the setup. Then attack the week.' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('ACTIVE TEAM')).toHaveValue(configuredTeam.id);
    fireEvent.click(screen.getByRole('button', { name: 'League rules' }));
    expect(screen.getByRole('heading', { name: 'Rules laboratory' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trade desk' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Trade desk' })).toBeInTheDocument();
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
    await screen.findByRole('heading', { name: 'Finish the setup. Then attack the week.' });

    fireEvent.click(screen.getByRole('button', { name: 'Automation' }));
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
    await screen.findByRole('heading', { name: 'Build your first front office.' });

    fireEvent.change(screen.getByLabelText('Team name'), {
      target: { value: configuredTeam.name },
    });
    fireEvent.change(screen.getByLabelText('ESPN league ID'), {
      target: { value: configuredTeam.espnLeagueId },
    });
    fireEvent.change(screen.getByLabelText('ESPN team ID'), {
      target: { value: configuredTeam.espnTeamId },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create team/ }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/teams', expect.objectContaining({ method: 'POST' })),
    );
    expect(
      await screen.findByRole('heading', { name: 'Finish the setup. Then attack the week.' }),
    ).toBeInTheDocument();
  });
});
