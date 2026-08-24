import {
  Activity,
  GitBranch,
  MessageCircle,
  Network,
  Save,
  Send,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';

import type { FanNetwork, FanNetworkInput, FanNetworkState } from '../types.js';

type Props = {
  state: FanNetworkState | null | undefined;
  busy: string | null;
  onSave: (input: FanNetworkInput) => Promise<void>;
  onMention: () => Promise<void>;
};

const providers: FanNetwork['agents'][number]['model']['provider'][] = [
  'codex',
  'openai',
  'ollama',
  'http',
  'none',
];

function updateAgent(
  network: FanNetwork,
  agentId: string,
  patch: Partial<FanNetwork['agents'][number]>,
): FanNetwork {
  return {
    ...network,
    agents: network.agents.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent)),
  };
}

export function FanNetworkPanel({ state, busy, onSave, onMention }: Props) {
  const [draft, setDraft] = useState<FanNetwork | null>(state?.network ?? null);

  if (!draft) {
    return (
      <div className="empty-panel">
        <Network size={23} />
        <p>Network configuration is unavailable.</p>
      </div>
    );
  }
  const network = draft;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave({
      enabled: network.enabled,
      name: network.name,
      agents: network.agents,
      routes: network.routes,
      policies: network.policies,
    });
  }

  return (
    <form className="content-stack fan-network-shell" onSubmit={submit}>
      <div className="section-heading">
        <div>
          <p className="kicker">CONFIGURABLE AGENT GRAPH</p>
          <h2>Agent network</h2>
          <p>
            Connect observers, analysts, voices, moderators, and publishers. Every event and run is
            persisted so model failures are visible instead of disappearing into a prompt.
          </p>
        </div>
        <Network size={32} />
      </div>

      <article className="network-hero">
        <div>
          <p className="kicker">ACTIVE ROUTE</p>
          <h3>Scout → Analyst → Voices → Commissioner → Publisher</h3>
          <span>
            {draft.agents.length} agents · {draft.routes.length} routes ·{' '}
            {state?.runs.filter((run) => run.status === 'failed').length ?? 0} failed runs
          </span>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={Boolean(busy) || !draft.enabled}
          onClick={() => void onMention()}
        >
          <MessageCircle size={16} /> {busy === 'network-mention' ? 'Routing…' : 'Test fan mention'}
        </button>
      </article>

      <article className="form-panel network-settings">
        <div className="panel-title">
          <div>
            <p className="kicker">NETWORK IDENTITY</p>
            <h3>Room settings</h3>
          </div>
          <SlidersHorizontal size={19} />
        </div>
        <label>
          Network name
          <input
            value={draft.name}
            maxLength={120}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="toggle-row">
          <span>
            <b>Enable network</b>
            <small>Pause event routing without deleting the graph or its audit trail.</small>
          </span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
        </label>
        <div className="network-policy-grid">
          <label className="toggle-row">
            <span>
              <b>Require evidence</b>
              <small>Agents must carry source references.</small>
            </span>
            <input
              type="checkbox"
              checked={draft.policies.requireEvidence}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  policies: { ...draft.policies, requireEvidence: event.target.checked },
                })
              }
            />
          </label>
          <label className="toggle-row">
            <span>
              <b>Identify as AI</b>
              <small>Replies carry an AI-generated label.</small>
            </span>
            <input
              type="checkbox"
              checked={draft.policies.identifyAsAi}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  policies: { ...draft.policies, identifyAsAi: event.target.checked },
                })
              }
            />
          </label>
          <label>
            Max replies/hour
            <input
              type="number"
              min="0"
              value={draft.policies.maxRepliesPerHour}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  policies: { ...draft.policies, maxRepliesPerHour: Number(event.target.value) },
                })
              }
            />
          </label>
          <label>
            Max turns/event
            <input
              type="number"
              min="1"
              max="20"
              value={draft.policies.maxTurnsPerEvent}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  policies: { ...draft.policies, maxTurnsPerEvent: Number(event.target.value) },
                })
              }
            />
          </label>
        </div>
      </article>

      <div className="network-agent-grid">
        {draft.agents.map((agent) => (
          <article
            className={`network-agent-card ${agent.enabled ? '' : 'disabled'}`}
            key={agent.id}
          >
            <div className="network-agent-head">
              <div>
                <span className="agent-role">{agent.role}</span>
                <h3>{agent.name}</h3>
                <small>{agent.id}</small>
              </div>
              <input
                aria-label={`Enable ${agent.name}`}
                type="checkbox"
                checked={agent.enabled}
                onChange={(event) =>
                  setDraft(updateAgent(draft, agent.id, { enabled: event.target.checked }))
                }
              />
            </div>
            <label>
              Model provider
              <select
                value={agent.model.provider}
                onChange={(event) =>
                  setDraft(
                    updateAgent(draft, agent.id, {
                      model: {
                        ...agent.model,
                        provider: event.target.value as typeof agent.model.provider,
                      },
                    }),
                  )
                }
              >
                {providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model id
              <input
                value={agent.model.modelId}
                onChange={(event) =>
                  setDraft(
                    updateAgent(draft, agent.id, {
                      model: { ...agent.model, modelId: event.target.value },
                    }),
                  )
                }
              />
            </label>
            <div className="agent-flow">
              <span>listens: {agent.listensTo.length}</span>
              <GitBranch size={13} />
              <span>emits: {agent.emits.length}</span>
            </div>
          </article>
        ))}
      </div>

      <article className="form-panel route-panel">
        <div className="panel-title">
          <div>
            <p className="kicker">EVENT ROUTES</p>
            <h3>How the room talks</h3>
          </div>
          <Activity size={19} />
        </div>
        <div className="route-list">
          {draft.routes.map((route) => (
            <div className="route-row" key={`${route.event}-${route.to.join('-')}`}>
              <code>{route.event}</code>
              <span>→</span>
              <b>{route.to.join(' · ')}</b>
              <small>{route.parallel ? 'parallel' : 'serial'}</small>
            </div>
          ))}
        </div>
      </article>

      <div className="network-events-panel">
        <div className="panel-title">
          <div>
            <p className="kicker">LIVE TRACE</p>
            <h3>Recent network events</h3>
          </div>
          <ShieldCheck size={19} />
        </div>
        {(state?.events ?? []).slice(0, 8).map((event) => (
          <div className="event-row" key={event.id}>
            <span>{event.type}</span>
            <small>
              {event.sourceAgentId ?? 'external'} · {new Date(event.createdAt).toLocaleTimeString()}
            </small>
          </div>
        ))}
        {(state?.events ?? []).length === 0 ? (
          <p className="quiet-note">
            No events yet. Test a fan mention to watch the route execute.
          </p>
        ) : null}
      </div>

      <button className="primary-button align-self" type="submit" disabled={Boolean(busy)}>
        <Save size={16} /> {busy === 'network-save' ? 'Saving…' : 'Save network configuration'}{' '}
        <Send size={14} />
      </button>
    </form>
  );
}
