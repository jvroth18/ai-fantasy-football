import type Database from 'better-sqlite3';

const migrations = [
  {
    version: 1,
    sql: `
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform = 'espn'),
        season INTEGER NOT NULL,
        time_zone TEXT NOT NULL,
        color TEXT NOT NULL,
        espn_league_id TEXT NOT NULL,
        espn_team_id TEXT NOT NULL,
        active_rule_set_id TEXT,
        strategy_profile_id TEXT,
        automation_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (platform, season, espn_league_id, espn_team_id)
      );
      CREATE TABLE IF NOT EXISTS league_rule_sets (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
        rule_set_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (team_id, revision)
      );
      CREATE TABLE IF NOT EXISTS strategy_profiles (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recommendations (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        recommendation_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS recommendations_team_created_idx
        ON recommendations(team_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS action_intents (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        action_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS action_intents_team_status_idx
        ON action_intents(team_id, status);
      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        run_json TEXT NOT NULL,
        scheduled_for TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS automation_runs_team_schedule_idx
        ON automation_runs(team_id, scheduled_for);
      CREATE TABLE IF NOT EXISTS codex_threads (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL,
        codex_thread_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (team_id, purpose)
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS player_identities (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        position TEXT NOT NULL,
        nfl_team TEXT,
        espn_id TEXT UNIQUE,
        sleeper_id TEXT UNIQUE,
        gsis_id TEXT UNIQUE,
        mapping_confidence_basis_points INTEGER NOT NULL,
        identity_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS player_identities_name_idx
        ON player_identities(full_name);
      CREATE TABLE IF NOT EXISTS data_snapshots (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        source_url TEXT NOT NULL,
        digest TEXT NOT NULL,
        record_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS data_snapshots_provider_fetched_idx
        ON data_snapshots(provider, fetched_at DESC);
      CREATE TABLE IF NOT EXISTS news_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        published_at TEXT NOT NULL,
        news_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS news_items_published_idx
        ON news_items(published_at DESC);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE action_intents_v3 (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        action_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (team_id, idempotency_key)
      );
      INSERT INTO action_intents_v3
        (id, team_id, idempotency_key, status, action_json, created_at, updated_at)
      SELECT id, team_id, idempotency_key, status, action_json, created_at, updated_at
      FROM action_intents;
      DROP TABLE action_intents;
      ALTER TABLE action_intents_v3 RENAME TO action_intents;
      CREATE INDEX action_intents_team_status_idx
        ON action_intents(team_id, status);

      ALTER TABLE automation_runs ADD COLUMN started_at TEXT;
      ALTER TABLE automation_runs ADD COLUMN finished_at TEXT;
      ALTER TABLE automation_runs ADD COLUMN error_code TEXT;

      CREATE TABLE action_execution_results (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        action_intent_id TEXT NOT NULL REFERENCES action_intents(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        outcome TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (team_id, idempotency_key)
      );
      CREATE INDEX action_execution_results_team_created_idx
        ON action_execution_results(team_id, created_at DESC);

      CREATE TABLE job_leases (
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        UNIQUE (team_id, job_type)
      );
      CREATE INDEX job_leases_expiration_idx ON job_leases(expires_at);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE portal_snapshots (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        league_id TEXT NOT NULL,
        platform_team_id TEXT NOT NULL,
        digest TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE INDEX portal_snapshots_team_observed_idx
        ON portal_snapshots(team_id, observed_at DESC);
    `,
  },
] as const;

export function applyMigrations(database: Database.Database): void {
  database.pragma('foreign_keys = ON');
  database.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );

  const hasMigration = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const recordMigration = database.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const migration of migrations) {
    if (hasMigration.get(migration.version)) continue;

    database.transaction(() => {
      database.exec(migration.sql);
      recordMigration.run(migration.version, new Date().toISOString());
    })();
  }
}
