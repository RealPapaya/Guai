// Low-level SQLite access via Node's built-in node:sqlite (flag-free on Node 24).
// Opens a connection, applies the idempotent schema, and exposes the raw handle.
// Everything above this goes through core/memory.js — nothing else opens the DB.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, 'schema.sql');
const SCHEMA_VERSION = '2';

/**
 * Open (and migrate) the Guai database.
 * @param {string} dbPath  Absolute path to the sqlite file, or ':memory:'.
 * @returns {DatabaseSync}
 */
export function openDb(dbPath) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  // Pragmas that need to be set on the connection (WAL also lives in schema.sql,
  // but busy_timeout must be set per connection so concurrent cron/Task writers
  // wait instead of throwing SQLITE_BUSY).
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');

  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  // Record schema version (best-effort; the schema itself is idempotent).
  db.prepare(
    `INSERT INTO meta(key, value) VALUES('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SCHEMA_VERSION);

  return db;
}

export { SCHEMA_VERSION };
