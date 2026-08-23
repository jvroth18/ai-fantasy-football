import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  (table) => [uniqueIndex('action_intents_idempotency_unique').on(table.idempotencyKey)],
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
});

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
