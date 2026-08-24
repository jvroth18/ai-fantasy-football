import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import type { CreateTeamInput } from '../types.js';

type Props = {
  onCreate: (input: CreateTeamInput) => Promise<void>;
  busy: boolean;
  compact?: boolean;
};

export function CreateTeamForm({ onCreate, busy, compact = false }: Props) {
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
    await onCreate(input);
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
        <label>
          ESPN league ID
          <input
            required
            value={input.espnLeagueId}
            placeholder="Visible in the league URL"
            onChange={(event) => setInput({ ...input, espnLeagueId: event.target.value })}
          />
        </label>
        <label>
          ESPN team ID
          <input
            required
            value={input.espnTeamId}
            placeholder="Your team number"
            onChange={(event) => setInput({ ...input, espnTeamId: event.target.value })}
          />
        </label>
        <label className="wide">
          League timezone
          <input
            required
            value={input.timeZone}
            placeholder="America/New_York"
            onChange={(event) => setInput({ ...input, timeZone: event.target.value })}
          />
        </label>
      </div>
      <div className="safe-start">
        <ShieldCheck size={18} />
        <span>Every new team starts local, independent, and ESPN mutations disarmed.</span>
      </div>
      <button className="primary-button" type="submit" disabled={busy}>
        {busy ? 'Creating team…' : 'Create team'} <ArrowRight size={17} />
      </button>
    </form>
  );
}
