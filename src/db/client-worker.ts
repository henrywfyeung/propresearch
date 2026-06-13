// Session-mode pool — used by:
//   - Inngest worker functions (graph node bodies)
//   - LangGraph PostgresSaver checkpointer
//   - NSW VG bulk ingest cron
//
// CLAUDE.md §16.3 / [R17] — session mode keeps prepared statements alive
// between transactions, which Drizzle's `postgres-js` driver and
// LangGraph's checkpointer both require.

import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Lazy init (see ./client.ts): WORKER_DATABASE_URL is a runtime need, so
// `next build` can import worker-touching modules (structuredCall, db/reports)
// to collect page data without the var present. The clear error still fires on
// first real use.
let cachedClient: ReturnType<typeof postgres> | null = null;
let cachedDb: PostgresJsDatabase<typeof schema> | null = null;

function getClient(): ReturnType<typeof postgres> {
  if (cachedClient) return cachedClient;
  const url = process.env.WORKER_DATABASE_URL;
  if (!url) {
    throw new Error('WORKER_DATABASE_URL is not set. Required for the worker client.');
  }
  // Session mode allows prepared statements (default) and lets us hold a
  // larger pool — a single long-lived Inngest worker process is the consumer,
  // so we don't pay the cold-start tax that pushed us to prepare:false on
  // the transaction-mode client.
  cachedClient = postgres(url, {
    max: 8, // long-lived worker process; keep modest pool
    idle_timeout: 0, // never drop idle connections — worker holds the pool
    connect_timeout: 10,
  });
  return cachedClient;
}

function getWorkerDb(): PostgresJsDatabase<typeof schema> {
  if (!cachedDb) cachedDb = drizzle(getClient(), { schema });
  return cachedDb;
}

// Drizzle handle — Proxy defers construction to first query.
export const workerDb: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop) {
      const real = getWorkerDb() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(real)
        : value;
    },
  },
);

// The raw postgres client is callable (tagged-template: client`SELECT …`) AND
// has methods (client.end() …), so its Proxy needs both `apply` and `get`.
export const workerSqlClient: ReturnType<typeof postgres> = new Proxy(
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
