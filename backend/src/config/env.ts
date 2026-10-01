import 'dotenv/config';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DATABASE_URL: optionalString,
  DB_HOST: optionalString,
  DB_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(3306)),
  DB_USER: optionalString,
  DB_PASSWORD: z.string().default(''),
  DB_NAME: optionalString,
  DB_SOCKET_PATH: optionalString,
  DB_CONNECTION_LIMIT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(10)),

  // Validated lazily via getJwtSecret() so migrations/seeding can run without it.
  JWT_SECRET: optionalString,
  JWT_EXPIRES_IN: z.string().default('8h'),

  HOTEL_NAME: z.string().default('Hotel Management System'),
  HOTEL_ADDRESS: z.string().default(''),
  HOTEL_PHONE: z.string().default(''),
  HOTEL_EMAIL: z.string().default(''),
  CURRENCY: z.string().default('USD'),
  TAX_RATE_PERCENT: z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(100).default(10)),

  SEED_ADMIN_NAME: z.string().default('System Admin'),
  SEED_ADMIN_EMAIL: z.string().default('admin@example.com'),
  SEED_ADMIN_PASSWORD: optionalString,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

const raw = parsed.data;

export interface DbConfig {
  host?: string;
  port: number;
  user: string;
  password: string;
  database: string;
  socketPath?: string;
}

function resolveDb(): DbConfig {
  if (raw.DATABASE_URL) {
    const url = new URL(raw.DATABASE_URL);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      socketPath: raw.DB_SOCKET_PATH,
    };
  }
  if ((!raw.DB_HOST && !raw.DB_SOCKET_PATH) || !raw.DB_USER || !raw.DB_NAME) {
    console.error(
      'Invalid environment configuration:\n  Set DATABASE_URL, or DB_HOST (or DB_SOCKET_PATH), DB_USER, DB_PASSWORD and DB_NAME.',
    );
    process.exit(1);
  }
  return {
    host: raw.DB_HOST,
    port: raw.DB_PORT,
    user: raw.DB_USER,
    password: raw.DB_PASSWORD,
    database: raw.DB_NAME,
    socketPath: raw.DB_SOCKET_PATH,
  };
}

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProd: raw.NODE_ENV === 'production',
  port: raw.PORT,
  corsOrigins: raw.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
  db: resolveDb(),
  dbConnectionLimit: raw.DB_CONNECTION_LIMIT,
  jwtSecret: raw.JWT_SECRET,
  jwtExpiresIn: raw.JWT_EXPIRES_IN,
  hotel: {
    name: raw.HOTEL_NAME,
    address: raw.HOTEL_ADDRESS,
    phone: raw.HOTEL_PHONE,
    email: raw.HOTEL_EMAIL,
    currency: raw.CURRENCY,
    taxRatePercent: raw.TAX_RATE_PERCENT,
  },
  seedAdmin: {
    name: raw.SEED_ADMIN_NAME,
    email: raw.SEED_ADMIN_EMAIL.toLowerCase(),
    password: raw.SEED_ADMIN_PASSWORD,
  },
};
