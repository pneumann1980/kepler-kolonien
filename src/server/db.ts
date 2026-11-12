// SQLite-Persistenz (node:sqlite, WAL). Eine Datei unter DATA_DIR.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { config, logInfo } from './config.ts';

export const db = new DatabaseSync(join(config.dataDir, 'kepler.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const MIGRATIONS: string[] = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE COLLATE NOCASE,
     pass_hash TEXT NOT NULL,
     color TEXT,
     is_admin INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     last_seen INTEGER NOT NULL
   );
   CREATE TABLE games (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     status TEXT NOT NULL,                 -- lobby | running | finished
     host_user INTEGER NOT NULL REFERENCES users(id),
     max_players INTEGER NOT NULL,
     options_json TEXT NOT NULL,
     seed TEXT,
     commitment TEXT,
     state_json TEXT,
     version INTEGER NOT NULL DEFAULT 0,
     deadline_at INTEGER,
     winners_json TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE game_players (
     game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
     player_id TEXT NOT NULL,
     user_id INTEGER REFERENCES users(id),
     name TEXT NOT NULL,
     color TEXT NOT NULL,
     seat INTEGER NOT NULL,
     is_bot INTEGER NOT NULL DEFAULT 0,
     rank INTEGER,
     score INTEGER,
     PRIMARY KEY (game_id, player_id)
   );
   CREATE INDEX idx_gp_user ON game_players(user_id);
   CREATE TABLE commands (
     game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL,
     player_id TEXT NOT NULL,
     cmd_json TEXT NOT NULL,
     by_bot INTEGER NOT NULL DEFAULT 0,
     ts INTEGER NOT NULL,
     PRIMARY KEY (game_id, seq)
   );
   CREATE TABLE push_subscriptions (
     endpoint TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     keys_json TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
];

function migrate(): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get() as { v: number } | undefined;
  let v = row?.v ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  if (v < MIGRATIONS.length) backup('pre-migration');
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      v++;
      db.prepare('UPDATE schema_version SET v = ?').run(v);
      db.exec('COMMIT');
      logInfo('DB-Migration angewendet', { version: v });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function backup(prefix = 'daily'): string | null {
  const dir = join(config.dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  try {
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  } catch {
    return null;
  }
  // Aufbewahrung
  const cutoff = Date.now() - config.backupRetentionDays * 86400_000;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
  }
  return file;
}

export function kvGet(k: string): string | null {
  const r = db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined;
  return r?.v ?? null;
}
export function kvSet(k: string, v: string): void {
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
}

if (existsSync(config.dataDir)) migrate();
