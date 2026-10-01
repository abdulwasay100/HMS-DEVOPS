import { createApp } from './app';
import { env } from './config/env';
import { getJwtSecret } from './config/jwt';
import { pool } from './db/pool';

async function main() {
  getJwtSecret();
  await pool.query('SELECT 1');

  const app = createApp();
  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`HMS API listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      await pool.end().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
