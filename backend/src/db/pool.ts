import mysql, {
  type Pool,
  type PoolConnection,
  type PoolOptions,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import { env } from '../config/env';

export type Executor = Pool | PoolConnection;

export function buildConnectionOptions(): PoolOptions {
  const { host, port, user, password, database, socketPath } = env.db;
  return {
    ...(socketPath ? { socketPath } : { host, port }),
    user,
    password,
    database,
    charset: 'utf8mb4',
    // DECIMAL columns come back as numbers, DATE columns as 'YYYY-MM-DD' strings,
    // DATETIME columns as JS Dates interpreted as UTC.
    decimalNumbers: true,
    dateStrings: ['DATE'],
    timezone: 'Z',
  };
}

export const pool: Pool = mysql.createPool({
  ...buildConnectionOptions(),
  waitForConnections: true,
  connectionLimit: env.dbConnectionLimit,
  queueLimit: 0,
});

// Force every session to UTC so CURRENT_TIMESTAMP defaults match the driver's interpretation.
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

export async function query<T = RowDataPacket>(
  sql: string,
  params: unknown[] = [],
  db: Executor = pool,
): Promise<T[]> {
  const [rows] = await db.query<RowDataPacket[]>(sql, params);
  return rows as unknown as T[];
}

export async function queryOne<T = RowDataPacket>(
  sql: string,
  params: unknown[] = [],
  db: Executor = pool,
): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params: unknown[] = [],
  db: Executor = pool,
): Promise<ResultSetHeader> {
  const [result] = await db.query<ResultSetHeader>(sql, params);
  return result;
}

export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}
