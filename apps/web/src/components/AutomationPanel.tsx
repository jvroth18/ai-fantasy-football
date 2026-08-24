import { LockKeyhole, Save, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import type { AutomationPolicy } from '../types.js';

type Props = {
  policy: AutomationPolicy;
  busy: boolean;
  onSave: (policy: AutomationPolicy, confirmation?: string) => Promise<void>;
};

const actionToggles: Array<{ key: keyof AutomationPolicy; label: string; detail: string }> = [
  {
    key: 'lineupChanges',
    label: 'Lineup changes',
    detail: 'Move unlocked players between legal slots.',
  },
  {
    key: 'waiverClaims',
    label: 'Waiver claims',
    detail: 'Submit bounded adds, drops, and FAAB bids.',
  },
  {
    key: 'freeAgentMoves',
    label: 'Free-agent moves',
    detail: 'Add available players outside waivers.',
  },
  {
    key: 'draftPicks',
    label: 'Draft picks',
    detail: 'Select one exact player only while this team is on clock.',
  },
  {
    key: 'outgoingTradeOffers',
    label: 'Outgoing trade offers',
    detail: 'Propose market-fair packages within rate limits.',
  },
];

export function AutomationPanel({ policy, busy, onSave }: Props) {
  const [draft, setDraft] = useState(policy);
  const [confirmation, setConfirmation] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave(draft, confirmation || undefined);
    setConfirmation('');
  }

  return (
    <form className="content-stack" onSubmit={submit}>
      <div className="section-heading">
        <div>
          <p className="kicker">HUMAN-CONTROLLED EXECUTION</p>
          <h2>ESPN action policy</h2>
          <p>
            Recommendations are automatic. Browser mutations remain separately gated, bounded, and
            verified.
          </p>
        </div>
        {policy.armed ? (
          <ShieldAlert className="warning-icon" size={32} />
        ) : (
          <ShieldCheck size={32} />
        )}
      </div>

      <article className={`master-arm ${draft.armed ? 'armed' : ''}`}>
        <div className="master-icon">{draft.armed ? <ShieldAlert /> : <LockKeyhole />}</div>
        <div>
          <p className="kicker">MASTER MUTATION GATE</p>
          <h3>{draft.armed ? 'ESPN actions armed' : 'ESPN actions disarmed'}</h3>
          <p>
            {draft.armed
              ? 'Enabled action classes may submit once after a fresh policy check.'
              : 'Codex can observe and recommend, but cannot change the ESPN league.'}
          </p>
        </div>
        <label className="switch-control">
          <input
            aria-label="Arm ESPN actions"
            type="checkbox"
            checked={draft.armed}
            onChange={(event) => setDraft({ ...draft, armed: event.target.checked })}
          />
          <span />
        </label>
      </article>

      {!policy.armed && draft.armed ? (
        <label className="confirmation-field">
          Type <code>ARM ESPN AUTOMATION</code> to confirm
          <input
            required
            value={confirmation}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      ) : null}

      <article className="form-panel">
        <div className="panel-title">
          <div>
            <p className="kicker">ACTION CLASSES</p>
            <h3>Independent permissions</h3>
          </div>
        </div>
        <div className="toggle-grid">
          {actionToggles.map((item) => (
            <label className="toggle-row" key={item.key}>
              <span>
                <b>{item.label}</b>
                <small>{item.detail}</small>
              </span>
              <input
                type="checkbox"
                checked={Boolean(draft[item.key])}
                onChange={(event) => setDraft({ ...draft, [item.key]: event.target.checked })}
              />
            </label>
          ))}
          <div className="toggle-row fixed-off">
            <span>
              <b>Incoming trade acceptance</b>
              <small>Permanently manual and absent from the executable action schema.</small>
            </span>
            <span className="status-pill retired">manual only</span>
          </div>
        </div>
      </article>

      <article className="form-panel policy-limits">
        <div className="panel-title">
          <div>
            <p className="kicker">HARD LIMITS</p>
            <h3>Budget and freshness</h3>
          </div>
        </div>
        <label>
          Max FAAB per claim
          <input
            type="number"
            min="0"
            placeholder="No limit"
            value={draft.maxFaabPerClaim ?? ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                maxFaabPerClaim: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Max FAAB per week
          <input
            type="number"
            min="0"
            placeholder="No limit"
            value={draft.maxFaabPerWeek ?? ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                maxFaabPerWeek: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Minimum FAAB reserve
          <input
            type="number"
            min="0"
            value={draft.minimumFaabReserve}
            onChange={(event) =>
              setDraft({ ...draft, minimumFaabReserve: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Maximum draft reach
          <input
            type="number"
            min="0"
            max="100"
            value={draft.maximumDraftReach}
            onChange={(event) =>
              setDraft({ ...draft, maximumDraftReach: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Data freshness (minutes)
          <input
            type="number"
            min="1"
            value={draft.minimumDataFreshnessMinutes}
            onChange={(event) =>
              setDraft({ ...draft, minimumDataFreshnessMinutes: Number(event.target.value) })
            }
          />
        </label>
      </article>

      <button
        className="primary-button align-self"
        type="submit"
        disabled={busy || (!policy.armed && draft.armed && confirmation !== 'ARM ESPN AUTOMATION')}
      >
        <Save size={17} /> {busy ? 'Saving…' : 'Save safety policy'}
      </button>
    </form>
  );
}
