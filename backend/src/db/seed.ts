import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { pool, queryOne, execute } from './pool';

/** Creates the first admin account if no admin exists yet. Idempotent. */
async function main() {
  const existing = await queryOne<{ id: number }>("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existing) {
    console.log('An admin user already exists. Nothing to do.');
    return;
  }

  const generated = !env.seedAdmin.password;
  const password = env.seedAdmin.password ?? crypto.randomBytes(9).toString('base64url');
  if (password.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters');
  }

  const hash = await bcrypt.hash(password, 12);
  await execute(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
    [env.seedAdmin.name, env.seedAdmin.email, hash],
  );

  console.log(`Created admin user: ${env.seedAdmin.email}`);
  if (generated) {
    console.log(`Generated password (shown once, change it after first login): ${password}`);
  }
}

main()
  .catch((err) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
