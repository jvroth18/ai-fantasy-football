import { ArrowRight, Link, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import type { CreateTeamInput } from '../types.js';

type Props = {
  onCreate: (input: CreateTeamInput) => Promise<void>;
  busy: boolean;
  compact?: boolean;
};

export function CreateTeamForm({ onCreate, busy, compact = false }: Props) {
  const [leagueUrl, setLeagueUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [input, setInput] = useState<CreateTeamInput>({
    name: '',
    season: new Date().getFullYear(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    color: '#b9f55b',
    espnLeagueId: '',
    espnTeamId: '',
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.espnLeagueId || !input.espnTeamId) {
      setUrlError('Paste your ESPN team page link, or enter both IDs under “Having trouble?”');
      return;
    }
    await onCreate(input);
  }

  function readLeagueUrl(value: string) {
    setLeagueUrl(value);
    setUrlError(null);
    if (!value.trim()) return;
    try {
      const url = new URL(value);
      const leagueId = url.searchParams.get('leagueId');
      const teamId = url.searchParams.get('teamId');
      if (!leagueId || !teamId) {
        setUrlError('Open your team page in ESPN, then copy the full address from the browser.');
        return;
      }
      setInput((current) => ({ ...current, espnLeagueId: leagueId, espnTeamId: teamId }));
    } catch {
      setUrlError('That does not look like a complete ESPN link.');
    }
  }

  return (
    <form className={`create-team-form ${compact ? 'compact' : ''}`} onSubmit={submit}>
      <div className="form-grid">
        <label className="wide">
          Team name
          <input
            required
            maxLength={100}
            value={input.name}
            placeholder="Fourth and Goal"
            onChange={(event) => setInput({ ...input, name: event.target.value })}
          />
        </label>
        <label className="wide league-link-field">
          ESPN team page link
          <span>
            <Link size={16} />
            <input
              aria-label="ESPN team page link"
              value={leagueUrl}
              placeholder="https://fantasy.espn.com/..."
              onChange={(event) => readLeagueUrl(event.target.value)}
            />
          </span>
          <small>In ESPN, open your team and copy the address from the top of your browser.</small>
        </label>
      </div>
      {urlError ? <p className="field-error">{urlError}</p> : null}
      {input.espnLeagueId && input.espnTeamId ? (
        <div className="link-success">
          <ShieldCheck size={15} /> ESPN league found
        </div>
      ) : null}
      <details className="connection-details">
        <summary>Having trouble? Enter details manually</summary>
        <div className="form-grid">
          <label>
            ESPN league ID
            <input
              value={input.espnLeagueId}
              onChange={(event) => setInput({ ...input, espnLeagueId: event.target.value })}
            />
          </label>
          <label>
            ESPN team ID
            <input
              value={input.espnTeamId}
              onChange={(event) => setInput({ ...input, espnTeamId: event.target.value })}
            />
          </label>
          <label>
            Season
            <input
              required
              type="number"
              min="2000"
              max="2100"
              value={input.season}
              onChange={(event) => setInput({ ...input, season: Number(event.target.value) })}
            />
          </label>
          <label>
            Accent
            <span className="color-input">
              <input
                aria-label="Team accent color"
                type="color"
                value={input.color}
                onChange={(event) => setInput({ ...input, color: event.target.value })}
              />
              <span>{input.color}</span>
            </span>
          </label>
          <label className="wide">
            League timezone
            <input
              required
              value={input.timeZone}
              onChange={(event) => setInput({ ...input, timeZone: event.target.value })}
            />
          </label>
        </div>
      </details>
      <div className="safe-start">
        <ShieldCheck size={18} />
        <span>Every new team starts local, independent, and ESPN mutations disarmed.</span>
      </div>
      <button className="primary-button" type="submit" disabled={busy}>
        {busy ? 'Connecting league…' : 'Connect league'} <ArrowRight size={17} />
      </button>
    </form>
  );
}
