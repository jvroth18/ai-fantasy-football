import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { applyMigrations } from './migrations.js';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export type DatabaseHandle = {
  raw: Database.Database;
  db: AppDatabase;
  close: () => void;
};

export function openDatabase(path = ':memory:'): DatabaseHandle {
  const raw = new Database(path);
  raw.pragma('foreign_keys = ON');
  raw.pragma('journal_mode = WAL');
  raw.pragma('busy_timeout = 5000');
  applyMigrations(raw);

  return {
    raw,
    db: drizzle(raw, { schema }),
    close: () => raw.close(),
  };
}
