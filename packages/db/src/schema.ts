import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const teams = sqliteTable(
  'teams',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    platform: text('platform', { enum: ['espn'] }).notNull(),
    season: integer('season').notNull(),
    timeZone: text('time_zone').notNull(),
    color: text('color').notNull(),
    espnLeagueId: text('espn_league_id').notNull(),
    espnTeamId: text('espn_team_id').notNull(),
    activeRuleSetId: text('active_rule_set_id'),
    strategyProfileId: text('strategy_profile_id'),
    automationJson: text('automation_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('teams_espn_season_unique').on(
      table.platform,
      table.season,
      table.espnLeagueId,
      table.espnTeamId,
    ),
  ],
);

export const leagueRuleSets = sqliteTable(
  'league_rule_sets',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    status: text('status', { enum: ['draft', 'active', 'retired'] }).notNull(),
    ruleSetJson: text('rule_set_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('rule_sets_team_revision_unique').on(table.teamId, table.revision)],
);

export const strategyProfiles = sqliteTable('strategy_profiles', {
  id: text('id').primaryKey(),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  profileJson: text('profile_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const recommendations = sqliteTable('recommendations', {
  id: text('id').primaryKey(),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  recommendationJson: text('recommendation_json').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const actionIntents = sqliteTable(
  'action_intents',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status').notNull(),
    actionJson: text('action_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('action_intents_team_idempotency_unique').on(table.teamId, table.idempotencyKey),
  ],
);

export const automationRuns = sqliteTable('automation_runs', {
  id: text('id').primaryKey(),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  jobType: text('job_type').notNull(),
  status: text('status').notNull(),
  runJson: text('run_json').notNull(),
  scheduledFor: text('scheduled_for').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  errorCode: text('error_code'),
});

export const actionExecutionResults = sqliteTable(
  'action_execution_results',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    actionIntentId: text('action_intent_id')
      .notNull()
      .references(() => actionIntents.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    outcome: text('outcome').notNull(),
    resultJson: text('result_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('action_results_team_idempotency_unique').on(table.teamId, table.idempotencyKey),
  ],
);

export const jobLeases = sqliteTable(
  'job_leases',
  {
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    jobType: text('job_type').notNull(),
    ownerId: text('owner_id').notNull(),
    acquiredAt: text('acquired_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [uniqueIndex('job_leases_team_job_unique').on(table.teamId, table.jobType)],
);

export const codexThreads = sqliteTable(
  'codex_threads',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    codexThreadId: text('codex_thread_id').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('codex_threads_team_purpose_unique').on(table.teamId, table.purpose)],
);

export const playerIdentities = sqliteTable(
  'player_identities',
  {
    id: text('id').primaryKey(),
    fullName: text('full_name').notNull(),
    position: text('position').notNull(),
    nflTeam: text('nfl_team'),
    espnId: text('espn_id'),
    sleeperId: text('sleeper_id'),
    gsisId: text('gsis_id'),
    mappingConfidence: integer('mapping_confidence_basis_points').notNull(),
    identityJson: text('identity_json').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('player_identities_espn_unique').on(table.espnId),
    uniqueIndex('player_identities_sleeper_unique').on(table.sleeperId),
    uniqueIndex('player_identities_gsis_unique').on(table.gsisId),
  ],
);

export const dataSnapshots = sqliteTable('data_snapshots', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  sourceUrl: text('source_url').notNull(),
  digest: text('digest').notNull(),
  recordCount: integer('record_count').notNull(),
  status: text('status').notNull(),
  fetchedAt: text('fetched_at').notNull(),
  metadataJson: text('metadata_json').notNull(),
});

export const newsItems = sqliteTable('news_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  source: text('source').notNull(),
  url: text('url').notNull().unique(),
  publishedAt: text('published_at').notNull(),
  newsJson: text('news_json').notNull(),
  fetchedAt: text('fetched_at').notNull(),
});

export const playerSeasonStats = sqliteTable(
  'player_season_stats',
  {
    gsisId: text('gsis_id').notNull(),
    season: integer('season').notNull(),
    statsJson: text('stats_json').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('player_season_stats_identity_unique').on(table.gsisId, table.season)],
);

export const playerReviews = sqliteTable(
  'player_reviews',
  {
    playerId: text('player_id')
      .primaryKey()
      .references(() => playerIdentities.id, { onDelete: 'cascade' }),
    overallRank: integer('overall_rank').notNull(),
    position: text('position').notNull(),
    positionRank: integer('position_rank').notNull(),
    scoreBasisPoints: integer('score_basis_points').notNull(),
    reviewJson: text('review_json').notNull(),
    generatedAt: text('generated_at').notNull(),
  },
  (table) => [
    index('player_reviews_overall_rank_idx').on(table.overallRank),
    index('player_reviews_position_rank_idx').on(table.position, table.positionRank),
  ],
);

export const portalSnapshots = sqliteTable(
  'portal_snapshots',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    leagueId: text('league_id').notNull(),
    platformTeamId: text('platform_team_id').notNull(),
    digest: text('digest').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    observedAt: text('observed_at').notNull(),
    capturedAt: text('captured_at').notNull(),
  },
  (table) => [index('portal_snapshots_team_observed_idx').on(table.teamId, table.observedAt)],
);
