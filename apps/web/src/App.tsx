import {
  Activity,
  Archive,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  Database,
  FileText,
  ExternalLink,
  Heart,
  Home,
  Network,
  LayoutDashboard,
  ListPlus,
  LoaderCircle,
  MessageCircle,
  Newspaper,
  Plus,
  Send,
  RefreshCw,
  Scale,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';

import { api, ApiError } from './api.js';
import { PlayerRankings } from './PlayerRankings.js';
import { AutomationPanel } from './components/AutomationPanel.js';
import { CreateTeamForm } from './components/CreateTeamForm.js';
import { FanDeskPanel } from './components/FanDeskPanel.js';
import { FanNetworkPanel } from './components/FanNetworkPanel.js';
import { RulesPanel } from './components/RulesPanel.js';
import { StrategyPanel, type StrategyInput } from './components/StrategyPanel.js';
import type {
  AutomationPolicy,
  Bootstrap,
  CreateTeamInput,
  LeagueTargetType,
  Recommendation,
  RuleImportResult,
  TeamDetail,
} from './types.js';

type Tab =
  | 'feed'
  | 'setup'
  | 'members'
  | 'archive'
  | 'command'
  | 'draft'
  | 'roster'
  | 'players'
  | 'waivers'
  | 'trades'
  | 'rules'
  | 'strategy'
  | 'automation'
  | 'fan'
  | 'network';

const navigation: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'feed', label: 'League feed', icon: Home },
  { id: 'setup', label: 'AI setup', icon: Sparkles },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'archive', label: 'Archive', icon: Archive },
];

const tabLabels: Record<Tab, string> = {
  feed: 'League feed',
  setup: 'AI setup',
  members: 'Members',
  archive: 'Archive',
  command: 'Command center',
  draft: 'Draft room',
  roster: 'Roster',
  players: 'Player rankings',
  waivers: 'Waivers',
  trades: 'Trade desk',
  rules: 'League rules',
  strategy: 'Strategy',
  automation: 'Automation',
  fan: 'Fan desk',
  network: 'Agent network',
};

const jobNames: Record<string, string> = {
  news_refresh: 'News refresh',
  data_refresh: 'Player data refresh',
  daily_manager: 'Daily manager',
  waiver_plan: 'Waiver plan',
  trade_market: 'Trade market scan',
  lineup_watch: 'Lineup watch',
  fan_digest: 'Fan desk bulletin',
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
  automationArmed,
  busy,
  onExecute,
}: {
  recommendations: Recommendation[];
  empty: string;
  automationArmed: boolean;
  busy: string | null;
  onExecute: (recommendation: Recommendation) => Promise<void>;
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
            {recommendation.action ? (
              <button
                className="recommendation-action"
                type="button"
                disabled={Boolean(busy) || !automationArmed}
                title={automationArmed ? undefined : 'Arm the matching action in Automation first'}
                onClick={() => void onExecute(recommendation)}
              >
                <ShieldCheck size={13} />
                {busy === `action:${recommendation.id}` ? 'Verifying…' : 'Execute on ESPN'}
              </button>
            ) : (
              <small className="advisory-label">Advisory only</small>
            )}
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
  const [tab, setTab] = useState<Tab>('feed');
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
  const teamColor = team?.color ?? '#5d7b62';
  const accentStyle = {
    '--team-accent': `color-mix(in srgb, ${teamColor} 45%, #405447)`,
  } as CSSProperties;
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
    await api.runJob(created.id, 'news_refresh').catch(() => null);
    await refreshBootstrap(created.id);
    await refreshTeam(created.id);
    setShowCreate(false);
    setTab('setup');
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

  async function executeRecommendation(recommendation: Recommendation) {
    if (!team || !recommendation.action) return;
    const confirmed = window.confirm(
      `Execute “${recommendation.title}” in ESPN?\n\nThe app will validate the live portal, make at most one submission attempt, and read the result back.`,
    );
    if (!confirmed) return;
    const result = await perform(
      `action:${recommendation.id}`,
      () => api.executeRecommendation(team.id, recommendation.id),
      'ESPN action completed',
    );
    if (!result) return;
    setNotice(
      result.outcome === 'verified'
        ? 'ESPN action verified by read-back'
        : `${result.outcome.replaceAll('_', ' ')}: ${result.errorCode ?? result.evidence.at(-1) ?? 'Review the portal'}`,
    );
    await Promise.all([refreshTeam(team.id), refreshBootstrap(team.id)]);
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

  async function saveFanDesk(input: Parameters<typeof api.saveFanDesk>[1]) {
    if (!team) return;
    const completed = await perform(
      'fan-save',
      () => api.saveFanDesk(team.id, input),
      'Fan desk voice saved',
    );
    if (!completed) return;
    await refreshTeam(team.id);
  }

  async function generateFanDesk() {
    if (!team) return;
    const completed = await perform(
      'fan-generate',
      () => api.generateFanDesk(team.id),
      'New fan bulletin published',
    );
    if (!completed) return;
    await refreshTeam(team.id);
  }

  async function saveFanNetwork(input: Parameters<typeof api.saveFanNetwork>[1]) {
    if (!team) return;
    const completed = await perform(
      'network-save',
      () => api.saveFanNetwork(team.id, input),
      'Agent network saved',
    );
    if (!completed) return;
    await refreshTeam(team.id);
  }

  async function testFanMention() {
    if (!team) return;
    const completed = await perform(
      'network-mention',
      () =>
        api.emitFanNetworkEvent(team.id, {
          type: 'fan.mention.received',
          payload: {
            channel: 'web',
            author: 'preview-user',
            text: 'Is this team actually making a move or just posting through it?',
          },
        }),
      'Fan mention routed through the network',
    );
    if (!completed) return;
    await refreshTeam(team.id);
  }

  async function createLeaguePost(memberId: string, body: string) {
    if (!team) return;
    const completed = await perform(
      'league-post',
      () => api.createLeaguePost(team.id, memberId, body),
      'Posted to the league',
    );
    if (completed) await refreshTeam(team.id);
  }

  async function toggleLeagueReaction(
    memberId: string,
    targetType: Parameters<typeof api.toggleLeagueReaction>[2],
    targetId: string,
  ) {
    if (!team) return;
    const completed = await perform(
      `reaction:${targetId}`,
      () => api.toggleLeagueReaction(team.id, memberId, targetType, targetId),
      'Reaction updated',
    );
    if (completed) await refreshTeam(team.id);
  }

  async function createLeagueComment(
    memberId: string,
    targetType: Parameters<typeof api.createLeagueComment>[2],
    targetId: string,
    body: string,
  ) {
    if (!team) return;
    const completed = await perform(
      `comment:${targetId}`,
      () => api.createLeagueComment(team.id, memberId, targetType, targetId, body),
      'Comment added',
    );
    if (completed) await refreshTeam(team.id);
  }

  async function refreshFeed() {
    if (!team) return;
    const completed = await perform(
      'feed-refresh',
      () => api.refreshFeed(team.id),
      'League feed checked for updates',
    );
    if (!completed) return;
    const attention = Object.entries(completed.steps)
      .filter(([, result]) => result.status === 'needs_attention')
      .map(([name]) => name);
    setNotice(
      attention.length > 0
        ? `Feed refreshed; ${attention.join(' and ')} need attention`
        : 'League feed is up to date',
    );
    await Promise.all([refreshTeam(team.id), refreshBootstrap(team.id)]);
  }

  async function addMember(displayName: string) {
    if (!team) return;
    const completed = await perform(
      'member-add',
      () => api.addMember(team.id, displayName),
      `${displayName} joined the league`,
    );
    if (completed) await refreshTeam(team.id);
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
            <p className="kicker">YOUR LEAGUE, ALIVE</p>
            <b>League House</b>
          </div>
        </header>
        <section className="welcome-grid">
          <div className="welcome-copy">
            <p className="kicker">THREE MINUTES TO KICKOFF</p>
            <h1>Connect your fantasy league.</h1>
            <p>
              Add your league and choose its AI personality. League moves, local conversation, and
              football news come together on one front page.
            </p>
            <div className="welcome-signals">
              <span>
                <Database size={17} /> Live league activity
              </span>
              <span>
                <Bot size={17} /> Your AI host
              </span>
              <span>
                <Users size={17} /> Local member profiles
              </span>
            </div>
          </div>
          <div className="welcome-form-card">
            <p className="step-label">01 / CONNECT ESPN</p>
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
            <p className="kicker">FANTASY SOCIAL</p>
            <b>League House</b>
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
                setTab('feed');
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
            <h1>{tabLabels[tab]}</h1>
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
            {tab === 'feed' ? (
              <LeagueFeed
                detail={selectedDetail}
                busy={busy}
                onRefresh={refreshFeed}
                onPost={createLeaguePost}
                onReact={toggleLeagueReaction}
                onComment={createLeagueComment}
                onNavigate={setTab}
              />
            ) : null}
            {tab === 'setup' ? (
              <SimpleSetup
                detail={selectedDetail}
                bootstrap={bootstrap}
                busy={busy}
                onSync={syncEspn}
                onRun={runJob}
                onNavigate={setTab}
              />
            ) : null}
            {tab === 'members' ? (
              <MembersPanel members={selectedDetail.members ?? []} busy={busy} onAdd={addMember} />
            ) : null}
            {tab === 'archive' ? <ArchivePanel onNavigate={setTab} /> : null}
            {tab === 'command' ? (
              <CommandCenter
                detail={selectedDetail}
                bootstrap={bootstrap}
                schedules={teamSchedules}
                busy={busy}
                onRun={runJob}
                onSyncEspn={syncEspn}
                onExecute={executeRecommendation}
                onNavigate={setTab}
              />
            ) : null}
            {tab === 'roster' ? (
              <RosterPanel detail={selectedDetail} busy={busy === 'espn-sync'} onSync={syncEspn} />
            ) : null}
            {tab === 'players' ? <PlayerRankings /> : null}
            {tab === 'draft' ? (
              <DecisionDesk
                kind="draft"
                detail={selectedDetail}
                busy={busy}
                onRun={() => runJob('daily_manager')}
                onExecute={executeRecommendation}
              />
            ) : null}
            {tab === 'waivers' ? (
              <DecisionDesk
                kind="waiver"
                detail={selectedDetail}
                busy={busy}
                onRun={() => runJob('waiver_plan')}
                onExecute={executeRecommendation}
              />
            ) : null}
            {tab === 'trades' ? (
              <DecisionDesk
                kind="trade"
                detail={selectedDetail}
                busy={busy}
                onRun={() => runJob('trade_market')}
                onExecute={executeRecommendation}
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
            {tab === 'fan' ? (
              <FanDeskPanel
                state={selectedDetail.fanDesk}
                busy={busy}
                onSave={saveFanDesk}
                onGenerate={generateFanDesk}
              />
            ) : null}
            {tab === 'network' ? (
              <FanNetworkPanel
                key={selectedDetail.fanNetwork?.network.updatedAt ?? 'new-network'}
                state={selectedDetail.fanNetwork}
                busy={busy}
                onSave={saveFanNetwork}
                onMention={testFanMention}
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

function LeagueFeed({
  detail,
  busy,
  onRefresh,
  onPost,
  onReact,
  onComment,
  onNavigate,
}: {
  detail: TeamDetail;
  busy: string | null;
  onRefresh: () => Promise<void>;
  onPost: (memberId: string, body: string) => Promise<void>;
  onReact: (memberId: string, targetType: LeagueTargetType, targetId: string) => Promise<void>;
  onComment: (
    memberId: string,
    targetType: LeagueTargetType,
    targetId: string,
    body: string,
  ) => Promise<void>;
  onNavigate: (tab: Tab) => void;
}) {
  const aiPosts = detail.fanDesk?.posts ?? [];
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<'all' | 'league' | 'news'>('all');
  const [memberId, setMemberId] = useState(detail.members?.[0]?.id ?? '');
  const currentMember =
    detail.members?.find((member) => member.id === memberId) ?? detail.members?.[0];
  const feedNews = filter === 'news' ? (detail.news ?? []) : (detail.news ?? []).slice(0, 4);
  const newsFreshness = detail.newsUpdatedAt
    ? `Updated ${formatDate(detail.newsUpdatedAt)}`
    : 'News not connected';
  const items = [
    ...(detail.leaguePosts ?? []).map((post) => ({
      type: 'member' as const,
      date: post.createdAt,
      post,
    })),
    ...aiPosts.map((post) => ({ type: 'ai' as const, date: post.createdAt, post })),
    ...feedNews.map((post) => ({ type: 'news' as const, date: post.publishedAt, post })),
  ]
    .filter(
      (item) =>
        filter === 'all' || (filter === 'league' ? item.type !== 'news' : item.type === 'news'),
    )
    .sort((left, right) => right.date.localeCompare(left.date));

  async function submitPost(event: FormEvent) {
    event.preventDefault();
    if (!currentMember || !draft.trim()) return;
    await onPost(currentMember.id, draft.trim());
    setDraft('');
  }

  return (
    <section className="social-layout">
      <div className="feed-column">
        <article className="feed-welcome">
          <div className="edition-line">
            <span>
              {new Intl.DateTimeFormat('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              }).format(new Date())}
            </span>
            <b>THE LEAGUE EDITION</b>
            <span>{detail.team.season} SEASON</span>
          </div>
          <div className="masthead-row">
            <div className="league-avatar">{detail.team.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <p className="masthead-title">League House</p>
              <h2>{detail.team.name}</h2>
            </div>
          </div>
          <p className="masthead-dek">
            League moves, sharp takes, and football news—as your sources update.
          </p>
        </article>

        <div className="league-score-strip" aria-label="League activity summary">
          <span>
            <b>{(detail.members ?? []).length}</b>{' '}
            {(detail.members ?? []).length === 1 ? 'Member' : 'Members'}
          </span>
          <span>
            <b>{(detail.leaguePosts ?? []).length + aiPosts.length}</b> League dispatches
          </span>
          <span>
            <i className={detail.newsUpdatedAt ? '' : 'offline'} /> {newsFreshness}
          </span>
        </div>

        <div className="feed-tabs" role="tablist" aria-label="Feed filter">
          {(['all', 'league', 'news'] as const).map((value) => (
            <button
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? 'active' : ''}
              key={value}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? 'For you' : value === 'league' ? 'League talk' : 'NFL news'}
            </button>
          ))}
        </div>

        <form className="league-composer" onSubmit={(event) => void submitPost(event)}>
          <div className="composer-identity">
            <div className="member-avatar">
              {currentMember?.displayName.slice(0, 1).toUpperCase() ?? '?'}
            </div>
            {detail.members && detail.members.length > 1 ? (
              <select
                aria-label="Post as"
                value={currentMember?.id ?? ''}
                onChange={(event) => setMemberId(event.target.value)}
              >
                {detail.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <label>
            <span className="sr-only">Post to your league</span>
            <textarea
              value={draft}
              maxLength={1000}
              placeholder="Talk to your league…"
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!currentMember || !draft.trim() || Boolean(busy)}>
            Post
          </button>
        </form>

        <div className="feed-section-label">
          <span>
            {filter === 'news'
              ? 'National wire'
              : filter === 'league'
                ? 'From the league'
                : 'Top stories'}
          </span>
          <div>
            <small>{newsFreshness}</small>
            <button type="button" disabled={Boolean(busy)} onClick={() => void onRefresh()}>
              <RefreshCw size={12} /> {busy === 'feed-refresh' ? 'Checking…' : 'Check sources'}
            </button>
          </div>
        </div>

        {items.length === 0 && !detail.fanDesk?.configured ? (
          <article className="feed-empty">
            <Sparkles size={28} />
            <h3>Give your league a voice</h3>
            <p>
              Choose an AI personality and it will turn real league activity into posts worth
              reacting to.
            </p>
            <button className="primary-button" type="button" onClick={() => onNavigate('setup')}>
              Set up the AI
            </button>
          </article>
        ) : null}

        {items.map((item, index) => {
          if (item.type === 'member')
            return (
              <article className="social-post human-post" key={item.post.id}>
                <div className="post-avatar human">
                  {item.post.authorName.slice(0, 1).toUpperCase()}
                </div>
                <div className="post-content">
                  <div className="post-byline">
                    <b>{item.post.authorName}</b>
                    <time>{formatDate(item.post.createdAt)}</time>
                  </div>
                  <p>{item.post.body}</p>
                  <PostActions
                    targetId={item.post.id}
                    targetType="member_post"
                    member={currentMember}
                    reactions={detail.leagueReactions ?? []}
                    comments={detail.leagueComments ?? []}
                    busy={busy}
                    onReact={onReact}
                    onComment={onComment}
                  />
                </div>
              </article>
            );
          if (item.type === 'news')
            return (
              <article
                className={`news-feed-card ${index === 0 ? 'featured' : ''}`}
                key={item.post.id}
              >
                <div className="news-source">
                  <Newspaper size={15} />
                  <b>{item.post.source}</b>
                  <time>{formatDate(item.post.publishedAt)}</time>
                </div>
                <h3>{item.post.title}</h3>
                {item.post.summary ? <p>{item.post.summary}</p> : null}
                <div className="news-footer">
                  <a href={item.post.url} target="_blank" rel="noreferrer">
                    Read source <ExternalLink size={13} />
                  </a>
                </div>
                <PostActions
                  targetId={item.post.id}
                  targetType="news"
                  member={currentMember}
                  reactions={detail.leagueReactions ?? []}
                  comments={detail.leagueComments ?? []}
                  busy={busy}
                  onReact={onReact}
                  onComment={onComment}
                />
              </article>
            );
          return (
            <article
              className={`social-post ai-post ${index === 0 ? 'featured' : ''}`}
              key={item.post.id}
            >
              <div className="post-avatar">
                <Bot size={18} />
              </div>
              <div className="post-content">
                <div className="post-byline">
                  <b>{detail.fanDesk?.profile.name}</b>
                  <span>AI host</span>
                  <time>{formatDate(item.post.createdAt)}</time>
                </div>
                <p className="post-kind">{item.post.kind.replaceAll('_', ' ')}</p>
                <h3>{item.post.headline}</h3>
                <p>{item.post.dek}</p>
                <div className="post-proof">
                  <ShieldCheck size={13} /> Based on {item.post.evidence.length} verified source
                  {item.post.evidence.length === 1 ? '' : 's'}
                </div>
                <PostActions
                  targetId={item.post.id}
                  targetType="ai_post"
                  member={currentMember}
                  reactions={detail.leagueReactions ?? []}
                  comments={detail.leagueComments ?? []}
                  busy={busy}
                  onReact={onReact}
                  onComment={onComment}
                />
              </div>
            </article>
          );
        })}

        {items.length === 0 && detail.fanDesk?.configured ? (
          <article className="feed-empty">
            <Activity size={28} />
            <h3>Your league is quiet—for now</h3>
            <p>Pull the latest league activity and NFL news to wake up the feed.</p>
            <button
              className="ghost-button"
              disabled={Boolean(busy)}
              onClick={() => void onRefresh()}
            >
              <Sparkles size={15} /> {busy === 'feed-refresh' ? 'Checking…' : 'Check for updates'}
            </button>
          </article>
        ) : null}
      </div>
      <aside className="league-rail">
        <div className="live-label">
          <span /> LIVE LEAGUE PULSE
        </div>
        <h3>
          {(detail.members ?? []).length} member{(detail.members ?? []).length === 1 ? '' : 's'} in
          the house
        </h3>
        <div className="pulse-stats">
          <span>
            <b>{(detail.leaguePosts ?? []).length}</b> league posts
          </span>
          <span>
            <b>{aiPosts.length}</b> AI takes
          </span>
          <span>
            <b>{(detail.news ?? []).length}</b> news stories
          </span>
        </div>
        <button type="button" onClick={() => onNavigate('members')}>
          <UserPlus size={15} /> Manage league members
        </button>
        <div className="rail-news">
          <p className="kicker">TRENDING NOW</p>
          {(detail.news ?? []).slice(0, 3).map((story, index) => (
            <a key={story.id} href={story.url} target="_blank" rel="noreferrer">
              <span>{index + 1}</span>
              <b>{story.title}</b>
              <small>{story.source}</small>
            </a>
          ))}
        </div>
      </aside>
    </section>
  );
}

function PostActions({
  targetId,
  targetType,
  member,
  reactions,
  comments,
  busy,
  onReact,
  onComment,
}: {
  targetId: string;
  targetType: LeagueTargetType;
  member: NonNullable<TeamDetail['members']>[number] | undefined;
  reactions: NonNullable<TeamDetail['leagueReactions']>;
  comments: NonNullable<TeamDetail['leagueComments']>;
  busy: string | null;
  onReact: (memberId: string, targetType: LeagueTargetType, targetId: string) => Promise<void>;
  onComment: (
    memberId: string,
    targetType: LeagueTargetType,
    targetId: string,
    body: string,
  ) => Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  const [comment, setComment] = useState('');
  const targetReactions = reactions.filter(
    (reaction) => reaction.targetType === targetType && reaction.targetId === targetId,
  );
  const targetComments = comments
    .filter((entry) => entry.targetType === targetType && entry.targetId === targetId)
    .toReversed();
  const liked = Boolean(
    member && targetReactions.some((reaction) => reaction.memberId === member.id),
  );

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!member || !comment.trim()) return;
    await onComment(member.id, targetType, targetId, comment.trim());
    setComment('');
    setReplying(false);
  }

  return (
    <div className="post-conversation">
      <div className="post-actions">
        <button
          type="button"
          className={liked ? 'liked' : ''}
          aria-label={
            targetReactions.length
              ? `${liked ? 'Unlike' : 'Like'} (${targetReactions.length} reaction${targetReactions.length === 1 ? '' : 's'})`
              : undefined
          }
          disabled={!member || Boolean(busy)}
          onClick={() => member && void onReact(member.id, targetType, targetId)}
        >
          <Heart size={15} fill={liked ? 'currentColor' : 'none'} />{' '}
          {targetReactions.length || 'Like'}
        </button>
        <button
          type="button"
          disabled={!member}
          aria-label={
            targetComments.length
              ? `Comment (${targetComments.length} comment${targetComments.length === 1 ? '' : 's'})`
              : undefined
          }
          onClick={() => setReplying(!replying)}
        >
          <MessageCircle size={15} /> {targetComments.length || 'Comment'}
        </button>
      </div>
      {targetComments.length > 0 ? (
        <div className="comment-thread">
          {targetComments.map((entry) => (
            <p key={entry.id}>
              <b>{entry.authorName}</b> {entry.body}
            </p>
          ))}
        </div>
      ) : null}
      {replying ? (
        <form className="inline-comment" onSubmit={(event) => void submitComment(event)}>
          <input
            autoFocus
            aria-label="Write a comment"
            maxLength={500}
            value={comment}
            placeholder="Add to the conversation…"
            onChange={(event) => setComment(event.target.value)}
          />
          <button type="submit" disabled={!comment.trim() || Boolean(busy)}>
            Reply
          </button>
        </form>
      ) : null}
    </div>
  );
}

function SimpleSetup({
  detail,
  bootstrap,
  busy,
  onSync,
  onRun,
  onNavigate,
}: {
  detail: TeamDetail;
  bootstrap: Bootstrap;
  busy: string | null;
  onSync: () => Promise<void>;
  onRun: (job: string) => Promise<void>;
  onNavigate: (tab: Tab) => void;
}) {
  const steps = [
    Boolean(detail.espnSnapshot),
    Boolean(detail.fanDesk?.configured),
    Boolean(bootstrap.data.rss),
  ];
  return (
    <section className="simple-setup content-stack">
      <div className="section-heading">
        <div>
          <p className="kicker">KEEP IT SIMPLE</p>
          <h2>Set up your league AI</h2>
          <p>Three choices get the experience running. Everything else can wait.</p>
        </div>
        <Sparkles size={32} />
      </div>
      <div className="setup-steps">
        <article className={steps[0] ? 'complete' : ''}>
          <span>1</span>
          <div>
            <h3>Connect league activity</h3>
            <p>Read the current ESPN league and roster from your signed-in browser.</p>
          </div>
          <button className="ghost-button" disabled={Boolean(busy)} onClick={() => void onSync()}>
            {steps[0] ? 'Sync again' : 'Connect ESPN'}
          </button>
        </article>
        <article className={steps[1] ? 'complete' : ''}>
          <span>2</span>
          <div>
            <h3>Choose the AI personality</h3>
            <p>Pick the name, voice, energy, and posting rhythm for your league host.</p>
          </div>
          <button className="ghost-button" onClick={() => onNavigate('fan')}>
            {steps[1] ? 'Edit personality' : 'Choose personality'}
          </button>
        </article>
        <article className={steps[2] ? 'complete' : ''}>
          <span>3</span>
          <div>
            <h3>Add live football news</h3>
            <p>Pull in relevant public news so league events have useful context.</p>
          </div>
          <button
            className="ghost-button"
            disabled={Boolean(busy)}
            onClick={() => void onRun('news_refresh')}
          >
            {steps[2] ? 'Refresh news' : 'Add news'}
          </button>
        </article>
      </div>
      <button
        className="primary-button align-self"
        type="button"
        onClick={() => onNavigate('feed')}
      >
        Go to league feed <Send size={16} />
      </button>
    </section>
  );
}

function MembersPanel({
  members,
  busy,
  onAdd,
}: {
  members: NonNullable<TeamDetail['members']>;
  busy: string | null;
  onAdd: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  async function submitMember(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await onAdd(name.trim());
    setName('');
  }
  return (
    <section className="members-shell content-stack">
      <div className="section-heading">
        <div>
          <p className="kicker">BETTER WITH RIVALS</p>
          <h2>Your league members</h2>
          <p>
            Add local profiles for shared-device testing. Secure invitations arrive with hosted
            identity.
          </p>
        </div>
        <UserPlus size={32} />
      </div>
      <article className="invite-card">
        <div>
          <small>HOSTED INVITATIONS</small>
          <b>Not available in this private local preview</b>
        </div>
        <button className="primary-button" type="button" disabled>
          Invite link coming next
        </button>
      </article>
      <form className="member-add-form" onSubmit={(event) => void submitMember(event)}>
        <label>
          Add someone on this device
          <input
            value={name}
            maxLength={60}
            placeholder="League member name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="ghost-button" disabled={!name.trim() || Boolean(busy)}>
          Add member
        </button>
      </form>
      <div className="member-list">
        {members.map((member) => (
          <article key={member.id}>
            <div className="member-avatar">{member.displayName.slice(0, 1).toUpperCase()}</div>
            <span>
              <b>{member.displayName}</b>
              <small>{member.role === 'owner' ? 'League owner' : 'Member'}</small>
            </span>
          </article>
        ))}
      </div>
      <p className="quiet-note">
        No shareable URL is issued until authentication, authorization, and expiring invitation
        tokens are enabled.
      </p>
    </section>
  );
}

function ArchivePanel({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const tools: Array<[Tab, string, string, LucideIcon]> = [
    ['command', 'Manager dashboard', 'Readiness, schedules, and recommendations', LayoutDashboard],
    ['roster', 'Roster', 'Verified ESPN roster state', Users],
    ['players', 'Player intelligence', 'Rankings and source-backed dossiers', Database],
    ['draft', 'Draft room', 'Draft recommendations', Trophy],
    ['waivers', 'Waivers', 'Adds, drops, and FAAB planning', ListPlus],
    ['trades', 'Trade desk', 'Roster-fit trade ideas', Scale],
    ['rules', 'League rules', 'Detailed scoring and roster settings', FileText],
    ['strategy', 'Strategy', 'Risk and roster preferences', Target],
    ['automation', 'Automation', 'Guarded ESPN actions', ShieldCheck],
    ['network', 'Agent network', 'Internal routing and traces', Network],
  ];
  return (
    <section className="content-stack">
      <div className="section-heading">
        <div>
          <p className="kicker">PRESERVED, NOT IN THE WAY</p>
          <h2>Advanced tools archive</h2>
          <p>
            The deep work is still here when you need it. It no longer defines the everyday
            experience.
          </p>
        </div>
        <Archive size={32} />
      </div>
      <div className="archive-grid">
        {tools.map(([id, title, description, Icon]) => (
          <button type="button" key={id} onClick={() => onNavigate(id)}>
            <Icon size={19} />
            <span>
              <b>{title}</b>
              <small>{description}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CommandCenter({
  detail,
  bootstrap,
  schedules,
  busy,
  onRun,
  onSyncEspn,
  onExecute,
  onNavigate,
}: {
  detail: TeamDetail;
  bootstrap: Bootstrap;
  schedules: Bootstrap['schedules'];
  busy: string | null;
  onRun: (job: string) => Promise<void>;
  onSyncEspn: () => Promise<void>;
  onExecute: (recommendation: Recommendation) => Promise<void>;
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
            automationArmed={team.automation.armed}
            busy={busy}
            onExecute={onExecute}
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
              <b>Roster snapshot</b>
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
  onExecute,
}: {
  kind: 'draft' | 'waiver' | 'trade';
  detail: TeamDetail;
  busy: string | null;
  onRun: () => Promise<void>;
  onExecute: (recommendation: Recommendation) => Promise<void>;
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
      <RecommendationList
        recommendations={recommendations}
        empty={copy.empty}
        automationArmed={detail.team.automation.armed}
        busy={busy}
        onExecute={onExecute}
      />
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
