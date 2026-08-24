import { Save, Sparkles, Target } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import type { Strategy } from '../types.js';

export type StrategyInput = Omit<Strategy, 'id' | 'teamId' | 'createdAt' | 'updatedAt'>;

type Props = {
  strategy: Strategy | null;
  busy: boolean;
  onSave: (input: StrategyInput) => Promise<void>;
};

const defaultStrategy: StrategyInput = {
  name: 'Balanced upside',
  riskTolerance: 0.6,
  faabAggressiveness: 0.55,
  benchChurn: 0.5,
  preferStacks: true,
  preferHandcuffs: false,
  positionWeights: { QB: 1, RB: 1.15, WR: 1.1, TE: 1 },
  protectedPlayerIds: [],
  blockedPlayerIds: [],
  targetPlayerIds: [],
  maximumTradeOffersPerOpponentPerWeek: 1,
};

function RangeField({
  label,
  value,
  onChange,
  low,
  high,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  low: string;
  high: string;
}) {
  return (
    <label className="range-field">
      <span>
        <b>{label}</b>
        <output>{Math.round(value * 100)}</output>
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <small>
        <span>{low}</span>
        <span>{high}</span>
      </small>
    </label>
  );
}

export function StrategyPanel({ strategy, busy, onSave }: Props) {
  const [input, setInput] = useState<StrategyInput>(strategy ?? defaultStrategy);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave(input);
  }

  return (
    <form className="content-stack" onSubmit={submit}>
      <div className="section-heading">
        <div>
          <p className="kicker">YOUR OPERATING PHILOSOPHY</p>
          <h2>Strategy profile</h2>
          <p>
            Codify how aggressively this team should draft, churn the bench, spend FAAB, and trade.
          </p>
        </div>
        <Target size={32} />
      </div>

      <article className="form-panel">
        <label className="strategy-name">
          Profile name
          <input
            required
            maxLength={120}
            value={input.name}
            onChange={(event) => setInput({ ...input, name: event.target.value })}
          />
        </label>
        <div className="range-grid">
          <RangeField
            label="Risk tolerance"
            value={input.riskTolerance}
            low="Floor first"
            high="Ceiling first"
            onChange={(riskTolerance) => setInput({ ...input, riskTolerance })}
          />
          <RangeField
            label="FAAB aggression"
            value={input.faabAggressiveness}
            low="Preserve"
            high="Attack"
            onChange={(faabAggressiveness) => setInput({ ...input, faabAggressiveness })}
          />
          <RangeField
            label="Bench churn"
            value={input.benchChurn}
            low="Patient"
            high="Reactive"
            onChange={(benchChurn) => setInput({ ...input, benchChurn })}
          />
        </div>
      </article>

      <article className="form-panel">
        <div className="panel-title">
          <div>
            <p className="kicker">POSITION ECONOMICS</p>
            <h3>Relative priority</h3>
          </div>
          <Sparkles size={19} />
        </div>
        <div className="position-weights">
          {(['QB', 'RB', 'WR', 'TE'] as const).map((position) => (
            <label key={position}>
              {position}
              <input
                type="number"
                min="0"
                max="5"
                step="0.05"
                value={input.positionWeights[position] ?? 1}
                onChange={(event) =>
                  setInput({
                    ...input,
                    positionWeights: {
                      ...input.positionWeights,
                      [position]: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <div className="toggle-grid">
          <label className="toggle-row">
            <span>
              <b>Prefer quarterback stacks</b>
              <small>Price correlated weekly upside into draft and trade ranks.</small>
            </span>
            <input
              type="checkbox"
              checked={input.preferStacks}
              onChange={(event) => setInput({ ...input, preferStacks: event.target.checked })}
            />
          </label>
          <label className="toggle-row">
            <span>
              <b>Prefer running-back handcuffs</b>
              <small>Reserve bench value for direct injury contingencies.</small>
            </span>
            <input
              type="checkbox"
              checked={input.preferHandcuffs}
              onChange={(event) => setInput({ ...input, preferHandcuffs: event.target.checked })}
            />
          </label>
        </div>
      </article>

      <article className="form-panel compact-fields">
        <label>
          Max weekly offers per opponent
          <input
            type="number"
            min="0"
            max="10"
            value={input.maximumTradeOffersPerOpponentPerWeek}
            onChange={(event) =>
              setInput({
                ...input,
                maximumTradeOffersPerOpponentPerWeek: Number(event.target.value),
              })
            }
          />
        </label>
        <p className="quiet-note">
          Protected, blocked, and target players will become editable from the roster and player
          explorer once identities are synced.
        </p>
      </article>

      <button className="primary-button align-self" type="submit" disabled={busy}>
        <Save size={17} /> {busy ? 'Saving…' : 'Save team strategy'}
      </button>
    </form>
  );
}
