// Single Postgres client for the whole app.
//
// This replaces the old transaction-mode/session-mode pair. That split existed
// only to satisfy Supabase's Supavisor pooler: transaction mode forbids
// prepared statements, session mode allows them, so routes and the Inngest
// worker needed different connections. Cloud SQL has one connection mode, so
// there is one client, with prepared statements on.
//
// Two connection paths:
//   - Cloud Run: Unix socket at /cloudsql/<instance>/.s.PGSQL.5432, mounted by
//     --add-cloudsql-instances, authenticated by a short-lived IAM access token
//     rather than a password. Nothing to store or rotate.
//   - Local dev: a plain DATABASE_URL, so `pnpm dev` and tests need no GCP.

import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import { GoogleAuth } from 'google-auth-library';
import postgres from 'postgres';
import * as schema from './schema';

// Cloud SQL IAM database authentication requires this exact scope.
const SQL_LOGIN_SCOPE = 'https://www.googleapis.com/auth/sqlservice.login';

let auth: GoogleAuth | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Mint an access token to use as the Postgres password. postgres.js calls this
 * per new backend, so it is cached until shortly before expiry — otherwise
 * every connection in the pool would cost a metadata-server round trip.
 */
async function getIamToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;

  auth ??= new GoogleAuth({ scopes: [SQL_LOGIN_SCOPE] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to mint a Cloud SQL IAM access token');

  // Tokens last ~1h. Refresh 5 minutes early so an in-flight connect never
  // races expiry.
  cachedToken = { value: token.token, expiresAt: now + 55 * 60 * 1000 };
  return token.token;
}

function makeClient(): ReturnType<typeof postgres> {
  const poolMax = Number(process.env.DB_POOL_MAX ?? '2');

  // Local dev / CI: plain connection string, no GCP involvement.
  const url = process.env.DATABASE_URL;
  if (url) {
    return postgres(url, { max: poolMax, idle_timeout: 20, connect_timeout: 10 });
  }

  const instance = process.env.CLOUD_SQL_INSTANCE_CONNECTION_NAME;
  const database = process.env.DB_NAME;
  const username = process.env.DB_IAM_USER;
  if (!instance || !database || !username) {
    throw new Error(
      'Database is not configured. Set DATABASE_URL for local dev, or ' +
        'CLOUD_SQL_INSTANCE_CONNECTION_NAME + DB_NAME + DB_IAM_USER on Cloud Run.',
    );
  }

  return postgres({
    // A host beginning with "/" makes postgres.js use a Unix socket, appending
    // /.s.PGSQL.<port> itself. This is the path Cloud Run mounts.
    host: `/cloudsql/${instance}`,
    database,
    username,
    password: getIamToken,
    max: poolMax,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: false, // Unix socket is already local to the sandbox; TLS would fail.
  });
}

// Lazy init: `next build` imports route modules to collect page data, so the
// connection must not be established at import time. The clear error still
// fires on first real use if configuration is genuinely missing.
let cachedClient: ReturnType<typeof postgres> | null = null;
let cachedDb: PostgresJsDatabase<typeof schema> | null = null;

function getClient(): ReturnType<typeof postgres> {
  cachedClient ??= makeClient();
  return cachedClient;
}

function getDb(): PostgresJsDatabase<typeof schema> {
  cachedDb ??= drizzle(getClient(), { schema });
  return cachedDb;
}

// Proxies keep every existing import shape working while deferring construction
// to first use.
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop) {
      const real = getDb() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(real)
        : value;
    },
  },
);

// The raw postgres client is callable (sql`SELECT …`) and has methods
// (sql.end()), so its Proxy needs both traps.
export const sqlClient: ReturnType<typeof postgres> = new Proxy(
  (() => undefined) as unknown as ReturnType<typeof postgres>,
  {
    apply(_target, _thisArg, args) {
      return (getClient() as unknown as (...a: unknown[]) => unknown)(...args);
    },
    get(_target, prop) {
      const real = getClient() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(real)
        : value;
    },
  },
);

export { schema };
