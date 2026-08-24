export type AutomationPolicy = {
  armed: boolean;
  lineupChanges: boolean;
  waiverClaims: boolean;
  freeAgentMoves: boolean;
  draftPicks: boolean;
  outgoingTradeOffers: boolean;
  incomingTradeAccepts: false;
  maxFaabPerClaim: number | null;
  maxFaabPerWeek: number | null;
  minimumFaabReserve: number;
  maximumDraftReach: number;
  minimumDataFreshnessMinutes: number;
};

export type Team = {
  schemaVersion: 1;
  id: string;
  name: string;
  platform: 'espn';
  season: number;
  timeZone: string;
  color: string;
  espnLeagueId: string;
  espnTeamId: string;
  activeRuleSetId: string | null;
  strategyProfileId: string | null;
  automation: AutomationPolicy;
  createdAt: string;
  updatedAt: string;
};

export type DataSnapshot = {
  id: string;
  provider: string;
  sourceUrl: string;
  digest: string;
  recordCount: number;
  status: string;
  fetchedAt: string;
  metadataJson: string;
};

export type CodexStatus = {
  authenticated: boolean;
  accountKind: string | null;
  modelCount: number;
  skillCount: number;
  defaultModel: string | null;
  computerUseAvailable: boolean;
  readyForDecisions: boolean;
  readyForEspn: boolean;
  issues: string[];
};

export type ScheduleEntry = {
  teamId: string;
  teamName: string;
  timeZone: string;
  jobType: string;
  cron: string;
  nextRun: string | null;
};

export type Bootstrap = {
  teams: Team[];
  schedules: ScheduleEntry[];
  codex: CodexStatus | null;
  data: Record<'sleeper' | 'nflverse' | 'rss', DataSnapshot | null>;
};

export type RuleSet = {
  schemaVersion: 1;
  id: string;
  teamId: string;
  name: string;
  season: number;
  platform: 'espn';
  status: 'draft' | 'active' | 'retired';
  revision: number;
  scoring: Array<{ stat: string; label: string; pointsPerUnit: number; unitSize: number }>;
  roster: Array<{
    slot: string;
    count: number;
    starter: boolean;
    eligiblePositions: string[];
  }>;
  draft: { type: string; teamCount: number; rounds: number };
  waivers: { type: string; budget: number | null };
  createdAt: string;
};

export type Strategy = {
  id: string;
  teamId: string;
  name: string;
  riskTolerance: number;
  faabAggressiveness: number;
  benchChurn: number;
  preferStacks: boolean;
  preferHandcuffs: boolean;
  positionWeights: Partial<Record<'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST', number>>;
  protectedPlayerIds: string[];
  blockedPlayerIds: string[];
  targetPlayerIds: string[];
  maximumTradeOffersPerOpponentPerWeek: number;
  createdAt: string;
  updatedAt: string;
};

export type PortalPlayer = {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  availability: 'active' | 'questionable' | 'doubtful' | 'out' | 'ir' | 'suspended' | 'unknown';
};

export type PortalSnapshotView = {
  id: string;
  teamId: string;
  leagueId: string;
  platformTeamId: string;
  digest: string;
  observedAt: string;
  capturedAt: string;
  snapshot: {
    signedIn: boolean;
    leagueId: string;
    teamId: string;
    page: string;
    roster: Array<PortalPlayer & { slot: string; locked: boolean }>;
    availablePlayers: Array<
      PortalPlayer & {
        acquisitionType: 'waiver' | 'free_agent' | 'unknown';
        rosteredPercent: number | null;
      }
    >;
    leagueTeams: Array<{ teamId: string; name: string; roster: PortalPlayer[] }>;
    faabRemaining: number | null;
    faabSpentThisWeek: number | null;
    waiverClaims: Array<{ actionId: string; status: string }>;
    tradeOffers: Array<{ actionId: string; status: string }>;
    draft: {
      status: 'pre_draft' | 'live' | 'complete';
      onClockTeamId: string | null;
      draftSlot: number | null;
      picks: Array<{ actionId: string; teamId: string; playerId: string }>;
    };
    observedAt: string;
  };
};

export type Recommendation = {
  id: string;
  type: 'draft' | 'lineup' | 'waiver' | 'drop' | 'trade';
  title: string;
  rationale: string;
  projectedPointDelta: number | null;
  projectedWinProbabilityDelta: number | null;
  risk: number;
  confidence: number;
  action: {
    type: 'lineup_change' | 'waiver_claim' | 'free_agent_move' | 'draft_pick' | 'trade_offer';
    payload: Record<string, unknown>;
  } | null;
  createdAt: string;
  expiresAt: string;
};

export type AutomationRun = {
  id: string;
  teamId: string;
  jobType: string;
  status: string;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ActionExecutionResult = {
  outcome: 'verified' | 'failed' | 'needs_attention' | 'cancelled';
  performed: boolean;
  replayed: boolean;
  evidence: string[];
  errorCode: string | null;
};

export type TeamDetail = {
  team: Team;
  rules: RuleSet[];
  strategy: Strategy | null;
  espnSnapshot: PortalSnapshotView | null;
  recommendations: Recommendation[];
  runs: AutomationRun[];
};

export type RuleConflict = { pointer: string; left: unknown; right: unknown };

export type RuleImportResult = {
  ruleSet: RuleSet;
  source: { name: string; digest: string; byteLength: number };
  conflictsWithActive: RuleConflict[];
  extraction: 'deterministic_json' | 'deterministic_csv' | 'codex';
};

export type CreateTeamInput = Pick<
  Team,
  'name' | 'season' | 'timeZone' | 'color' | 'espnLeagueId' | 'espnTeamId'
>;
