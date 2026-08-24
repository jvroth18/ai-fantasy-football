import {
  Activity,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  Database,
  FileText,
  LayoutDashboard,
  ListPlus,
  LoaderCircle,
  Plus,
  RefreshCw,
  Scale,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

import { api, ApiError } from './api.js';
import { AutomationPanel } from './components/AutomationPanel.js';
import { CreateTeamForm } from './components/CreateTeamForm.js';
import { RulesPanel } from './components/RulesPanel.js';
import { StrategyPanel, type StrategyInput } from './components/StrategyPanel.js';
import type {
  AutomationPolicy,
  Bootstrap,
  CreateTeamInput,
  Recommendation,
  RuleImportResult,
  TeamDetail,
} from './types.js';

type Tab =
  'command' | 'draft' | 'roster' | 'waivers' | 'trades' | 'rules' | 'strategy' | 'automation';

const navigation: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'command', label: 'Command center', icon: LayoutDashboard },
  { id: 'draft', label: 'Draft room', icon: Trophy },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'waivers', label: 'Waivers', icon: ListPlus },
  { id: 'trades', label: 'Trade desk', icon: Scale },
  { id: 'rules', label: 'League rules', icon: FileText },
  { id: 'strategy', label: 'Strategy', icon: Target },
  { id: 'automation', label: 'Automation', icon: ShieldCheck },
];

const jobNames: Record<string, string> = {
  news_refresh: 'News refresh',
  data_refresh: 'Player data refresh',
  daily_manager: 'Daily manager',
  waiver_plan: 'Waiver plan',
  trade_market: 'Trade market scan',
  lineup_watch: 'Lineup watch',
};

function formatDate(value: string | null | undefined, fallback = 'Not yet') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function ReadinessItem({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return (
    <div className={`readiness-item ${done ? 'done' : ''}`}>
      <span>{done ? <Check size={14} /> : null}</span>
      <div>
        <b>{label}</b>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function RecommendationList({
  recommendations,
  empty,
}: {
  recommendations: Recommendation[];
  empty: string;
}) {
  if (recommendations.length === 0) {
    return (
      <div className="empty-panel small">
        <Sparkles size={23} />
        <p>{empty}</p>
      </div>
    );
  }
  return (
    <div className="recommendation-list">
      {recommendations.map((recommendation) => (
        <article key={recommendation.id}>
          <div className="recommendation-type">{recommendation.type}</div>
          <div>
            <h3>{recommendation.title}</h3>
            <p>{recommendation.rationale}</p>
          </div>
          <dl>
            <div>
              <dt>Confidence</dt>
              <dd>{Math.round(recommendation.confidence * 100)}%</dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>{Math.round(recommendation.risk * 100)}%</dd>
            </div>
            {recommendation.projectedPointDelta !== null ? (
              <div>
                <dt>Point delta</dt>
                <dd>
                  {recommendation.projectedPointDelta > 0 ? '+' : ''}
                  {recommendation.projectedPointDelta.toFixed(1)}
                </dd>
              </div>
            ) : null}
          </dl>
        </article>
      ))}
    </div>
  );
}

export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [tab, setTab] = useState<Tab>('command');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshBootstrap = useCallback(async (preferTeamId?: string) => {
    const next = await api.bootstrap();
    setBootstrap(next);
    setSelectedTeamId((current) => {
      const preferred = preferTeamId ?? current;
      return next.teams.some((team) => team.id === preferred)
        ? preferred
        : (next.teams[0]?.id ?? null);
    });
    return next;
  }, []);

  const refreshTeam = useCallback(async (teamId: string) => {
    const next = await api.team(teamId);
    setDetail(next);
    return next;
  }, []);

  useEffect(() => {
    let current = true;
    void api
      .bootstrap()
      .then((next) => {
        if (!current) return;
        setBootstrap(next);
        setSelectedTeamId(next.teams[0]?.id ?? null);
      })
      .catch((caught: unknown) => current && setError(errorMessage(caught)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedTeamId) return;
    let current = true;
    void api
      .team(selectedTeamId)
      .then((next) => current && setDetail(next))
      .catch((caught: unknown) => current && setError(errorMessage(caught)));
    return () => {
      current = false;
    };
  }, [selectedTeamId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedDetail = detail?.team.id === selectedTeamId ? detail : null;
  const team =
    selectedDetail?.team ??
    bootstrap?.teams.find((candidate) => candidate.id === selectedTeamId) ??
    null;
  const accentStyle = { '--team-accent': team?.color ?? '#b9f55b' } as CSSProperties;
  const teamSchedules = useMemo(
    () => bootstrap?.schedules.filter((entry) => entry.teamId === selectedTeamId) ?? [],
    [bootstrap?.schedules, selectedTeamId],
  );

  async function perform<T>(
    key: string,
    action: () => Promise<T>,
    message: string,
  ): Promise<T | null> {
    setBusy(key);
    setError(null);
    try {
      const result = await action();
      setNotice(message);
      return result;
    } catch (caught) {
      setError(errorMessage(caught));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function createTeam(input: CreateTeamInput) {
    const created = await perform(
      'create-team',
      () => api.createTeam(input),
      `${input.name} is ready for onboarding`,
    );
    if (!created) return;
    await refreshBootstrap(created.id);
    await refreshTeam(created.id);
    setShowCreate(false);
    setTab('command');
  }

  async function runJob(jobType: string) {
    if (!team) return;
    const completed = await perform(
      jobType,
      () => api.runJob(team.id, jobType),
      `${jobNames[jobType] ?? jobType} completed`,
    );
    if (completed === null) return;
    await Promise.all([refreshTeam(team.id), refreshBootstrap(team.id)]);
  }

  async function syncEspn() {
    if (!team) return;
    const completed = await perform(
      'espn-sync',
      () => api.syncEspn(team.id),
      'Verified ESPN snapshot saved',
    );
    if (completed === null) return;
    await refreshTeam(team.id);
  }

  async function uploadRules(file: File): Promise<RuleImportResult | null> {
    if (!team) return null;
    const result = await perform(
      'rule-upload',
      () => api.uploadRules(team.id, file),
      'Rule draft extracted for review',
    );
    if (result) await refreshTeam(team.id);
    return result;
  }

  async function activateRules(ruleSetId: string) {
    if (!team) return;
    const completed = await perform(
      'rule-activate',
      () => api.activateRules(team.id, ruleSetId),
      'Reviewed rules are now active',
    );
    if (completed === null) return;
    await Promise.all([refreshTeam(team.id), refreshBootstrap(team.id)]);
  }

  async function saveStrategy(input: StrategyInput) {
    if (!team) return;
    const completed = await perform(
      'strategy',
      () => api.saveStrategy(team.id, input),
      'Strategy profile saved',
    );
    if (completed === null) return;
    await Promise.all([refreshTeam(team.id), refreshBootstrap(team.id)]);
  }

  async function saveAutomation(policy: AutomationPolicy, confirmation?: string) {
    if (!team) return;
    const completed = await perform(
      'automation',
      () => api.saveAutomation(team.id, policy, confirmation),
      policy.armed ? 'ESPN safety policy saved' : 'ESPN actions disarmed',
    );
    if (completed === null) return;
    await Promise.all([refreshTeam(team.id), refreshBootstrap(team.id)]);
  }

  if (loading) {
    return (
      <main className="loading-screen">
        <LoaderCircle className="spin" />
        <p>Starting your local front office…</p>
      </main>
    );
  }

  if (!bootstrap) {
    return (
      <main className="loading-screen error-screen">
        <Activity />
        <h1>Local daemon unavailable</h1>
        <p>{error ?? 'Start the daemon on 127.0.0.1:4318 and reload.'}</p>
      </main>
    );
  }

  if (bootstrap.teams.length === 0) {
    return (
      <main className="welcome-shell" style={accentStyle}>
        <header className="welcome-brand">
          <span>FF</span>
          <div>
            <p className="kicker">LOCAL FANTASY OPERATIONS</p>
            <b>Front Office AI</b>
          </div>
        </header>
        <section className="welcome-grid">
          <div className="welcome-copy">
            <p className="kicker">THE SEASON STARTS WITH CONTEXT</p>
            <h1>Build your first front office.</h1>
            <p>
              Create an isolated team workspace, then teach it your league rules, strategy, and ESPN
              binding. Recommendations remain grounded in each team’s mechanics.
            </p>
            <div className="welcome-signals">
              <span>
                <Database size={17} /> Free football data
              </span>
              <span>
                <Bot size={17} /> Codex decisions
              </span>
              <span>
                <ShieldCheck size={17} /> Guarded execution
              </span>
            </div>
          </div>
          <div className="welcome-form-card">
            <p className="step-label">01 / TEAM IDENTITY</p>
            <CreateTeamForm onCreate={createTeam} busy={busy === 'create-team'} />
          </div>
        </section>
        {error ? <div className="toast error">{error}</div> : null}
      </main>
    );
  }

  return (
    <div className="app-shell" style={accentStyle}>
      <aside className="sidebar">
        <div className="brand">
          <span>FF</span>
          <div>
            <p className="kicker">FRONT OFFICE</p>
            <b>AI Manager</b>
          </div>
        </div>
        <div className="team-switcher">
          <label htmlFor="team-select">ACTIVE TEAM</label>
          <div>
            <i style={{ background: team?.color }} />
            <select
              id="team-select"
              value={selectedTeamId ?? ''}
              onChange={(event) => {
                setSelectedTeamId(event.target.value);
                setTab('command');
              }}
            >
              {bootstrap.teams.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
          <button type="button" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> Add another team
          </button>
        </div>
        <nav aria-label="Team workspace">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={tab === id ? 'active' : ''}
              key={id}
              type="button"
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === 'automation' && team?.automation.armed ? <i className="armed-dot" /> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className={`connection-dot ${bootstrap.codex?.readyForDecisions ? 'online' : ''}`} />
          <div>
            <b>Codex {bootstrap.codex?.readyForDecisions ? 'ready' : 'attention'}</b>
            <small>{bootstrap.codex?.defaultModel ?? 'No model available'}</small>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="kicker">
              {team?.season} · ESPN {team?.espnLeagueId}
            </p>
            <h1>{navigation.find((item) => item.id === tab)?.label}</h1>
          </div>
          <div className="header-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh workspace"
              disabled={Boolean(busy)}
              onClick={() =>
                team && void Promise.all([refreshBootstrap(team.id), refreshTeam(team.id)])
              }
            >
              <RefreshCw size={17} />
            </button>
            <div className="local-status">
              <span /> Local only
            </div>
          </div>
        </header>

        {!selectedDetail || !team ? (
          <div className="panel-loader">
            <LoaderCircle className="spin" />
            <span>Loading team intelligence…</span>
          </div>
        ) : (
          <>
            {tab === 'command' ? (
              <CommandCenter
                detail={selectedDetail}
                bootstrap={bootstrap}
                schedules={teamSchedules}
                busy={busy}
                onRun={runJob}
                onSyncEspn={syncEspn}
                onNavigate={setTab}
              />
            ) : null}
            {tab === 'roster' ? (
              <RosterPanel detail={selectedDetail} busy={busy === 'espn-sync'} onSync={syncEspn} />
            ) : null}
            {tab === 'draft' ? (
              <DecisionDesk
                kind="draft"
                detail={selectedDetail}
                busy={busy}
                onRun={() => runJob('daily_manager')}
              />
            ) : null}
            {tab === 'waivers' ? (
              <DecisionDesk
                kind="waiver"
                detail={selectedDetail}
                busy={busy}
                onRun={() => runJob('waiver_plan')}
              />
            ) : null}
            {tab === 'trades' ? (
              <DecisionDesk
                kind="trade"
                detail={selectedDetail}
                busy={busy}
                onRun={() => runJob('trade_market')}
              />
            ) : null}
            {tab === 'rules' ? (
              <RulesPanel
                rules={selectedDetail.rules}
                activeRuleSetId={team.activeRuleSetId}
                busy={Boolean(busy)}
                onUpload={uploadRules}
                onActivate={activateRules}
              />
            ) : null}
            {tab === 'strategy' ? (
              <StrategyPanel
                key={selectedDetail.strategy?.updatedAt ?? 'new-strategy'}
                strategy={selectedDetail.strategy}
                busy={busy === 'strategy'}
                onSave={saveStrategy}
              />
            ) : null}
            {tab === 'automation' ? (
              <AutomationPanel
                key={team.updatedAt}
                policy={team.automation}
                busy={busy === 'automation'}
                onSave={saveAutomation}
              />
            ) : null}
          </>
        )}
      </main>

      {showCreate ? (
        <div className="modal-backdrop">
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-team-title"
          >
            <button
              className="modal-close"
              aria-label="Close"
              type="button"
              onClick={() => setShowCreate(false)}
            >
              <X />
            </button>
            <p className="kicker">NEW INDEPENDENT WORKSPACE</p>
            <h2 id="create-team-title">Add another team</h2>
            <p>
              Rules, strategy, recommendations, runs, and ESPN actions remain fully team-scoped.
            </p>
            <CreateTeamForm compact onCreate={createTeam} busy={busy === 'create-team'} />
          </section>
        </div>
      ) : null}
      {error ? (
        <div className="toast error">
          <X size={15} />
          {error}
          <button aria-label="Dismiss error" type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="toast success">
          <Check size={15} />
          {notice}
        </div>
      ) : null}
    </div>
  );
}

function CommandCenter({
  detail,
  bootstrap,
  schedules,
  busy,
  onRun,
  onSyncEspn,
  onNavigate,
}: {
  detail: TeamDetail;
  bootstrap: Bootstrap;
  schedules: Bootstrap['schedules'];
  busy: string | null;
  onRun: (job: string) => Promise<void>;
  onSyncEspn: () => Promise<void>;
  onNavigate: (tab: Tab) => void;
}) {
  const { team } = detail;
  const checks = [
    Boolean(team.activeRuleSetId),
    Boolean(team.strategyProfileId),
    Boolean(bootstrap.data.sleeper),
    Boolean(detail.espnSnapshot),
  ];
  const readiness = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  const schedulesWithDates = schedules
    .filter((entry) => entry.nextRun)
    .sort((a, b) => String(a.nextRun).localeCompare(String(b.nextRun)))
    .slice(0, 5);
  const activeRules = detail.rules.find((rule) => rule.id === team.activeRuleSetId);

  return (
    <section className="content-stack">
      <article className="command-hero">
        <div>
          <p className="kicker">TEAM READINESS · {readiness}%</p>
          <h2>
            {readiness === 100
              ? 'Your front office has context.'
              : 'Finish the setup. Then attack the week.'}
          </h2>
          <p>
            {readiness === 100
              ? 'Rules, strategy, public data, and verified ESPN state are available for grounded decisions.'
              : 'The manager will stop and ask for attention instead of inventing advice from missing inputs.'}
          </p>
          <div className="hero-actions">
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => onRun('daily_manager')}
            >
              <Sparkles size={17} /> Run daily manager
            </button>
            <button
              className="ghost-button"
              type="button"
              disabled={Boolean(busy)}
              onClick={onSyncEspn}
            >
              <RefreshCw size={16} /> Sync ESPN
            </button>
          </div>
        </div>
        <div
          className="readiness-ring"
          style={{ '--readiness': `${readiness * 3.6}deg` } as CSSProperties}
        >
          <div>
            <b>{readiness}</b>
            <span>% ready</span>
          </div>
        </div>
      </article>

      <div className="metric-grid">
        <article>
          <div className="metric-icon">
            <FileText />
          </div>
          <p>ACTIVE RULES</p>
          <b>{team.activeRuleSetId ? `v${activeRules?.revision ?? '—'}` : 'Missing'}</b>
          <small>
            {team.activeRuleSetId
              ? `${activeRules?.scoring.length ?? 0} scoring mechanics`
              : 'Upload and review league rules'}
          </small>
        </article>
        <article>
          <div className="metric-icon">
            <Users />
          </div>
          <p>ESPN ROSTER</p>
          <b>{detail.espnSnapshot?.snapshot.roster.length ?? '—'}</b>
          <small>
            {detail.espnSnapshot
              ? `Observed ${formatDate(detail.espnSnapshot.observedAt)}`
              : 'No verified snapshot'}
          </small>
        </article>
        <article>
          <div className="metric-icon">
            <Database />
          </div>
          <p>PLAYER UNIVERSE</p>
          <b>{bootstrap.data.sleeper?.recordCount.toLocaleString() ?? 'Not seeded'}</b>
          <small>
            {bootstrap.data.sleeper
              ? `Updated ${formatDate(bootstrap.data.sleeper.fetchedAt)}`
              : 'Run the free data refresh'}
          </small>
        </article>
        <article>
          <div className="metric-icon">
            <Bot />
          </div>
          <p>CODEX CONTROL</p>
          <b>{bootstrap.codex?.readyForEspn ? 'Ready' : 'Attention'}</b>
          <small>
            {bootstrap.codex
              ? `${bootstrap.codex.modelCount} models · ${bootstrap.codex.skillCount} skills`
              : 'Readiness unavailable'}
          </small>
        </article>
      </div>

      <div className="dashboard-grid">
        <article className="dashboard-panel onboarding-panel">
          <div className="panel-title">
            <div>
              <p className="kicker">OPERATING FOUNDATION</p>
              <h3>Onboarding checklist</h3>
            </div>
            <span>{checks.filter(Boolean).length}/4</span>
          </div>
          <ReadinessItem
            done={Boolean(team.activeRuleSetId)}
            label="Activate league mechanics"
            detail="Scoring, roster, draft, waivers, and trade settings"
          />
          <ReadinessItem
            done={Boolean(team.strategyProfileId)}
            label="Define strategy"
            detail="Risk, FAAB, roster construction, and trade posture"
          />
          <ReadinessItem
            done={Boolean(bootstrap.data.sleeper)}
            label="Seed public data"
            detail="Players, trends, nflverse catalog, and news"
          />
          <ReadinessItem
            done={Boolean(detail.espnSnapshot)}
            label="Verify ESPN state"
            detail="Visible league binding, roster, waivers, and draft state"
          />
          <div className="checklist-actions">
            {!team.activeRuleSetId ? (
              <button type="button" onClick={() => onNavigate('rules')}>
                Upload rules
              </button>
            ) : null}
            {!team.strategyProfileId ? (
              <button type="button" onClick={() => onNavigate('strategy')}>
                Set strategy
              </button>
            ) : null}
            {!bootstrap.data.sleeper ? (
              <button type="button" disabled={Boolean(busy)} onClick={() => onRun('data_refresh')}>
                Refresh data
              </button>
            ) : null}
            {!detail.espnSnapshot ? (
              <button type="button" disabled={Boolean(busy)} onClick={onSyncEspn}>
                Sync ESPN
              </button>
            ) : null}
          </div>
        </article>

        <article className="dashboard-panel schedule-panel">
          <div className="panel-title">
            <div>
              <p className="kicker">AUTOMATIC CADENCE</p>
              <h3>Next local runs</h3>
            </div>
            <CalendarClock size={19} />
          </div>
          {schedulesWithDates.length === 0 ? (
            <p className="quiet-note">
              Schedules appear after this team is loaded by the local daemon.
            </p>
          ) : (
            schedulesWithDates.map((entry) => (
              <div className="schedule-row" key={`${entry.teamId}-${entry.jobType}`}>
                <span>
                  <b>{jobNames[entry.jobType] ?? entry.jobType}</b>
                  <small>{entry.timeZone}</small>
                </span>
                <time>{formatDate(entry.nextRun)}</time>
              </div>
            ))
          )}
          <div className="manual-jobs">
            <button type="button" disabled={Boolean(busy)} onClick={() => onRun('news_refresh')}>
              Refresh news
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => onRun('data_refresh')}>
              Refresh data
            </button>
          </div>
        </article>
      </div>

      <div className="dashboard-grid recommendations-grid">
        <article className="dashboard-panel">
          <div className="panel-title">
            <div>
              <p className="kicker">ACTION QUEUE</p>
              <h3>Current recommendations</h3>
            </div>
            <Activity size={19} />
          </div>
          <RecommendationList
            recommendations={detail.recommendations.slice(0, 4)}
            empty="Complete onboarding and run the daily manager to generate grounded actions."
          />
        </article>
        <article className="dashboard-panel run-panel">
          <div className="panel-title">
            <div>
              <p className="kicker">AUDIT TRAIL</p>
              <h3>Recent manager runs</h3>
            </div>
            <Settings2 size={19} />
          </div>
          {detail.runs.length === 0 ? (
            <p className="quiet-note">No management jobs have run for this team.</p>
          ) : (
            detail.runs.slice(0, 7).map((run) => (
              <div className="run-row" key={run.id}>
                <span className={`run-status ${run.status}`} />
                <div>
                  <b>{jobNames[run.jobType] ?? run.jobType}</b>
                  <small>{run.errorCode ?? formatDate(run.finishedAt ?? run.scheduledFor)}</small>
                </div>
                <em>{run.status.replaceAll('_', ' ')}</em>
              </div>
            ))
          )}
        </article>
      </div>
    </section>
  );
}

function RosterPanel({
  detail,
  busy,
  onSync,
}: {
  detail: TeamDetail;
  busy: boolean;
  onSync: () => Promise<void>;
}) {
  const portal = detail.espnSnapshot;
  return (
    <section className="content-stack">
      <div className="section-heading">
        <div>
          <p className="kicker">VERIFIED PORTAL STATE</p>
          <h2>Roster command</h2>
          <p>Every roster decision is anchored to a visible, team-bound ESPN observation.</p>
        </div>
        <button className="primary-button small" type="button" disabled={busy} onClick={onSync}>
          <RefreshCw size={16} /> {busy ? 'Observing…' : 'Sync ESPN'}
        </button>
      </div>
      {!portal ? (
        <div className="empty-panel tall">
          <Users size={31} />
          <h3>No verified roster snapshot</h3>
          <p>
            Open the correct ESPN fantasy team in your signed-in browser, then run a read-only sync.
          </p>
        </div>
      ) : (
        <>
          <div className="snapshot-banner">
            <ShieldCheck size={18} />
            <span>
              <b>Digest verified</b>
              <small>
                League {portal.leagueId} · Team {portal.platformTeamId} ·{' '}
                {formatDate(portal.observedAt)}
              </small>
            </span>
            <code>{portal.digest.slice(0, 12)}</code>
          </div>
          <div className="roster-table" role="table" aria-label="ESPN roster">
            <div className="roster-head" role="row">
              <span>Slot</span>
              <span>Player</span>
              <span>NFL</span>
              <span>Status</span>
            </div>
            {portal.snapshot.roster.map((player) => (
              <div className="roster-row" role="row" key={player.playerId}>
                <span className="slot-badge">{player.slot}</span>
                <span>
                  <b>{player.name}</b>
                  <small>{player.position}</small>
                </span>
                <span>{player.nflTeam ?? 'FA'}</span>
                <span className={player.locked ? 'locked' : 'open'}>
                  {player.locked ? 'Locked' : 'Editable'}
                </span>
              </div>
            ))}
          </div>
          <div className="metric-grid compact-metrics">
            <article>
              <p>AVAILABLE VIEW</p>
              <b>{portal.snapshot.availablePlayers.length}</b>
              <small>Players captured in current view</small>
            </article>
            <article>
              <p>PENDING WAIVERS</p>
              <b>
                {portal.snapshot.waiverClaims.filter((claim) => claim.status === 'pending').length}
              </b>
              <small>Observed claims</small>
            </article>
            <article>
              <p>OUTGOING TRADES</p>
              <b>
                {portal.snapshot.tradeOffers.filter((offer) => offer.status === 'pending').length}
              </b>
              <small>Pending proposals</small>
            </article>
            <article>
              <p>DRAFT STATE</p>
              <b>{portal.snapshot.draft.status.replace('_', ' ')}</b>
              <small>{portal.snapshot.draft.picks.length} captured picks</small>
            </article>
          </div>
        </>
      )}
    </section>
  );
}

function DecisionDesk({
  kind,
  detail,
  busy,
  onRun,
}: {
  kind: 'draft' | 'waiver' | 'trade';
  detail: TeamDetail;
  busy: string | null;
  onRun: () => Promise<void>;
}) {
  const copy = {
    draft: {
      kicker: 'SCARCITY + VALUE OVER REPLACEMENT',
      title: 'Draft war room',
      description:
        'Rank the board against league scoring, roster construction, positional cliffs, and your configured reach limit.',
      button: 'Refresh draft board',
      empty:
        'The draft board will populate after rules, strategy, player data, and a current draft snapshot are available.',
    },
    waiver: {
      kicker: 'ADDITIONS REQUIRE EXPLICIT DROPS',
      title: 'Waiver planner',
      description:
        'Pair every add with a safe drop, price FAAB against replacement value, and preserve your configured reserve.',
      button: 'Build waiver plan',
      empty:
        'Run the waiver planner after syncing the ESPN available-player view and refreshing public player signals.',
    },
    trade: {
      kicker: 'MARKET-FAIR, MUTUALLY USEFUL PACKAGES',
      title: 'Trade desk',
      description:
        'Find roster-fit exchanges, model both sides, and respect opponent contact limits before proposing an offer.',
      button: 'Scan trade market',
      empty:
        'Trade ideas appear only when player values, roster needs, and a current team snapshot support them.',
    },
  }[kind];
  const types = kind === 'waiver' ? ['waiver', 'drop'] : [kind];
  const recommendations = detail.recommendations.filter((recommendation) =>
    types.includes(recommendation.type),
  );
  return (
    <section className="content-stack">
      <article className="decision-hero">
        <div>
          <p className="kicker">{copy.kicker}</p>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
          <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={onRun}>
            <Sparkles size={17} />
            {busy ? 'Analyzing…' : copy.button}
          </button>
        </div>
        <div className="decision-glyph">
          {kind === 'draft' ? <Trophy /> : kind === 'waiver' ? <ListPlus /> : <Scale />}
        </div>
      </article>
      <RecommendationList recommendations={recommendations} empty={copy.empty} />
      <article className="guardrail-panel">
        <ShieldCheck size={20} />
        <div>
          <b>Analysis first, action second</b>
          <p>
            Recommendations never imply permission to mutate ESPN. The separate action policy, fresh
            portal validation, one-attempt rule, and read-back proof still apply.
          </p>
        </div>
      </article>
    </section>
  );
}
