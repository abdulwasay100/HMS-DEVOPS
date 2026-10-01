import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { buildConnectionOptions } from './pool';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');
const LOCK_NAME = 'hms_schema_migrations';

async function main() {
  const conn = await mysql.createConnection({ ...buildConnectionOptions(), multipleStatements: true });
  await conn.query("SET time_zone = '+00:00'");

  // Advisory lock so parallel deployments never run migrations concurrently.
  const [[lock]] = (await conn.query('SELECT GET_LOCK(?, 60) AS acquired', [LOCK_NAME])) as any;
  if (lock.acquired !== 1) {
    throw new Error('Could not acquire migration lock');
  }

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(190) NOT NULL PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [appliedRows] = (await conn.query('SELECT name FROM schema_migrations')) as any;
    const applied = new Set<string>(appliedRows.map((r: { name: string }) => r.name));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`Applying migration ${file} ...`);
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      count += 1;
    }

    console.log(count === 0 ? 'Database is up to date.' : `Applied ${count} migration(s).`);
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => undefined);
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
