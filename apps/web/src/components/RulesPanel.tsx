import { Check, FileSearch, ShieldAlert, UploadCloud } from 'lucide-react';
import { useState } from 'react';

import type { RuleImportResult, RuleSet } from '../types.js';

type Props = {
  rules: RuleSet[];
  activeRuleSetId: string | null;
  busy: boolean;
  onUpload: (file: File) => Promise<RuleImportResult | null>;
  onActivate: (ruleSetId: string) => Promise<void>;
};

export function RulesPanel({ rules, activeRuleSetId, busy, onUpload, onActivate }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<RuleImportResult | null>(null);

  async function upload() {
    if (!file) return;
    const result = await onUpload(file);
    if (result) {
      setReview(result);
      setFile(null);
    }
  }

  return (
    <section className="content-stack">
      <div className="section-heading">
        <div>
          <p className="kicker">LEAGUE-SPECIFIC INTELLIGENCE</p>
          <h2>Rules laboratory</h2>
          <p>
            Upload the source of truth. Every extraction lands as a draft and requires an explicit
            activation before it can drive scoring or strategy.
          </p>
        </div>
        <span className="count-badge">{rules.length} versions</span>
      </div>

      <article className="upload-card">
        <div className="upload-icon">
          <UploadCloud size={25} />
        </div>
        <div>
          <h3>Import league rules</h3>
          <p>PDF, screenshots, text, Markdown, JSON, or scoring CSV · 10 MB maximum</p>
        </div>
        <label className="file-picker">
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.json,.csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? file.name : 'Choose file'}
        </label>
        <button
          className="primary-button small"
          type="button"
          disabled={!file || busy}
          onClick={upload}
        >
          {busy ? 'Extracting…' : 'Upload & review'}
        </button>
      </article>

      {review ? (
        <article className="review-card">
          <div className="review-title">
            <FileSearch size={21} />
            <div>
              <p className="kicker">REVIEW REQUIRED</p>
              <h3>
                {review.ruleSet.name} · revision {review.ruleSet.revision}
              </h3>
            </div>
            <span className="method-badge">{review.extraction.replaceAll('_', ' ')}</span>
          </div>
          <div className="rule-metrics">
            <span>
              <b>{review.ruleSet.scoring.length}</b> scoring rules
            </span>
            <span>
              <b>{review.ruleSet.roster.length}</b> roster slots
            </span>
            <span>
              <b>{review.conflictsWithActive.length}</b> active differences
            </span>
            <span>
              <b>{review.source.byteLength.toLocaleString()}</b> source bytes
            </span>
          </div>
          {review.conflictsWithActive.length > 0 ? (
            <details className="conflicts">
              <summary>
                <ShieldAlert size={16} /> Inspect changed mechanics
              </summary>
              <ul>
                {review.conflictsWithActive.slice(0, 20).map((conflict) => (
                  <li key={conflict.pointer}>
                    <code>{conflict.pointer}</code>
                    <span>
                      {String(conflict.left ?? 'unset')} → {String(conflict.right ?? 'unset')}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="quiet-note">No active-version differences to reconcile.</p>
          )}
          <button
            className="primary-button"
            type="button"
            disabled={busy || activeRuleSetId === review.ruleSet.id}
            onClick={() => onActivate(review.ruleSet.id)}
          >
            <Check size={17} /> Activate reviewed revision
          </button>
        </article>
      ) : null}

      <div className="version-list">
        {rules.length === 0 ? (
          <div className="empty-panel">
            <FileSearch size={28} />
            <h3>No league rules yet</h3>
            <p>Start with the official rules page export or clear screenshots from ESPN.</p>
          </div>
        ) : (
          [...rules].reverse().map((ruleSet) => (
            <article className="version-row" key={ruleSet.id}>
              <div className={`version-dot ${ruleSet.status}`} />
              <div className="version-copy">
                <div>
                  <h3>{ruleSet.name}</h3>
                  <span>
                    Revision {ruleSet.revision} · {ruleSet.season}
                  </span>
                </div>
                <p>
                  {ruleSet.scoring.length} scoring mechanics · {ruleSet.roster.length} slot types ·{' '}
                  {ruleSet.draft.type} draft · {ruleSet.waivers.type} waivers
                </p>
              </div>
              <span className={`status-pill ${ruleSet.status}`}>{ruleSet.status}</span>
              {ruleSet.status === 'draft' ? (
                <button
                  className="ghost-button"
                  type="button"
                  disabled={busy}
                  onClick={() => onActivate(ruleSet.id)}
                >
                  Activate
                </button>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
