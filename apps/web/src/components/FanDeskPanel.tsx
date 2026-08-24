import { Flame, Mail, Mic2, Radio, Save, Send, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import type { FanDeskInput, FanDeskState } from '../types.js';

type Props = {
  state: FanDeskState | null | undefined;
  busy: string | null;
  onSave: (input: FanDeskInput) => Promise<void>;
  onGenerate: () => Promise<void>;
};

const fallback: FanDeskInput = {
  name: 'The Stands',
  voice: 'superfan',
  heat: 0.68,
  rumorTolerance: 0.35,
  cadence: 'every_3_hours',
  enabled: true,
  emailEnabled: false,
  emailAddress: null,
  emailSubjectPrefix: 'Fan Desk',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function FanDeskPanel({ state, busy, onSave, onGenerate }: Props) {
  const [draft, setDraft] = useState<FanDeskInput>(state?.profile ?? fallback);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave(draft);
  }

  return (
    <section className="content-stack fan-desk-shell">
      <div className="section-heading">
        <div>
          <p className="kicker">THE LEAGUE HAS A PRESS BOX NOW</p>
          <h2>Fan desk</h2>
          <p>
            Every bulletin starts with what the ESPN scan and news feed actually observed, then
            turns the signal into a voice your league will remember.
          </p>
        </div>
        <Mic2 size={32} />
      </div>

      <article className="fan-desk-hero">
        <div className="fan-desk-signal">
          <Radio size={18} />
          <span>
            Cadence <b>{state?.profile.cadence.replaceAll('_', ' ') ?? 'not configured'}</b>
          </span>
        </div>
        <div className="fan-desk-signal">
          <Flame size={18} />
          <span>
            Heat <b>{Math.round((state?.profile.heat ?? draft.heat) * 100)}%</b>
          </span>
        </div>
        <div className="fan-desk-signal">
          <Mail size={18} />
          <span>
            Email <b>{state?.profile.emailEnabled ? state.profile.emailAddress : 'off'}</b>
          </span>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={Boolean(busy) || !draft.enabled}
          onClick={() => void onGenerate()}
        >
          <Sparkles size={17} /> {busy === 'fan-generate' ? 'Watching…' : 'Generate bulletin'}
        </button>
      </article>

      <form className="form-panel fan-desk-settings" onSubmit={submit}>
        <div className="panel-title">
          <div>
            <p className="kicker">VOICE SETTINGS</p>
            <h3>Pick the personality</h3>
          </div>
          <Flame size={19} />
        </div>
        <div className="fan-desk-grid">
          <label>
            Desk name
            <input
              value={draft.name}
              maxLength={80}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            Voice
            <select
              value={draft.voice}
              onChange={(event) =>
                setDraft({ ...draft, voice: event.target.value as FanDeskInput['voice'] })
              }
            >
              <option value="superfan">Superfan</option>
              <option value="contrarian">Contrarian</option>
              <option value="analyst">Sports analyst</option>
              <option value="commissioner">Commissioner</option>
            </select>
          </label>
          <label>
            Cadence
            <select
              value={draft.cadence}
              onChange={(event) =>
                setDraft({ ...draft, cadence: event.target.value as FanDeskInput['cadence'] })
              }
            >
              <option value="hourly">Hourly</option>
              <option value="every_3_hours">Every 3 hours</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label>
            Email recipient
            <input
              type="email"
              placeholder="you@example.com"
              value={draft.emailAddress ?? ''}
              onChange={(event) => setDraft({ ...draft, emailAddress: event.target.value || null })}
            />
          </label>
          <label className="fan-desk-range">
            Heat <output>{Math.round(draft.heat * 100)}%</output>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={draft.heat}
              onChange={(event) => setDraft({ ...draft, heat: Number(event.target.value) })}
            />
          </label>
          <label className="fan-desk-range">
            Rumor tolerance <output>{Math.round(draft.rumorTolerance * 100)}%</output>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={draft.rumorTolerance}
              onChange={(event) =>
                setDraft({ ...draft, rumorTolerance: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <label className="toggle-row">
          <span>
            <b>Publish this desk</b>
            <small>Disable it to pause scheduled bulletins without losing the archive.</small>
          </span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
        </label>
        <label className="toggle-row">
          <span>
            <b>Send email digests</b>
            <small>Requires a configured Resend sender in the local daemon.</small>
          </span>
          <input
            type="checkbox"
            checked={draft.emailEnabled}
            onChange={(event) => setDraft({ ...draft, emailEnabled: event.target.checked })}
          />
        </label>
        <button className="ghost-button align-self" type="submit" disabled={Boolean(busy)}>
          <Save size={16} /> {busy === 'fan-save' ? 'Saving…' : 'Save fan desk'}
        </button>
      </form>

      <div className="fan-post-list">
        {(state?.posts ?? []).length === 0 ? (
          <div className="empty-panel">
            <Mic2 size={23} />
            <p>No bulletins yet. Run the desk after your first ESPN scan.</p>
          </div>
        ) : (
          (state?.posts ?? []).map((post) => (
            <article className="fan-post-card" key={post.id}>
              <div className="fan-post-meta">
                <span>{post.kind.replaceAll('_', ' ')}</span>
                <span>{formatDate(post.createdAt)}</span>
                <span>{post.generatedBy === 'codex' ? 'Codex voice' : 'evidence template'}</span>
              </div>
              <h3>{post.headline}</h3>
              <p className="fan-post-dek">{post.dek}</p>
              <p className="fan-post-body">{post.body}</p>
              <div className="fan-post-footer">
                <b>STANCE</b>
                <span>{post.stance}</span>
                <small>
                  {post.evidence.length} source{post.evidence.length === 1 ? '' : 's'} attached
                </small>
                <Send size={14} />
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
