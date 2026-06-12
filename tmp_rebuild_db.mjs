import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';

const output = 'state/guai-clean.db';
rmSync(output, { force: true });

const db = new DatabaseSync('state/guai.db');
db.exec('PRAGMA secure_delete = ON');
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
).all().map((row) => row.name);
for (const table of tables) {
  const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all();
  for (const column of columns) {
    const rows = db.prepare(
      `SELECT rowid, CAST(${JSON.stringify(column.name)} AS TEXT) AS value
       FROM ${JSON.stringify(table)}
       WHERE lower(CAST(${JSON.stringify(column.name)} AS TEXT)) LIKE '%jarvis%'`,
    ).all();
    for (const row of rows) {
      db.prepare(
        `UPDATE ${JSON.stringify(table)} SET ${JSON.stringify(column.name)} = ? WHERE rowid = ?`,
      ).run(String(row.value).replace(/jarvis/gi, 'worker'), Number(row.rowid));
    }
  }
}
db.exec('REINDEX');
db.exec(`VACUUM INTO '${output}'`);
db.close();

const clean = new DatabaseSync(output, { readOnly: true });
console.log(clean.prepare('PRAGMA integrity_check').get().integrity_check);
clean.close();
