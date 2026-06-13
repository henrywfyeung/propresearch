// Transaction-mode pool — used by Next.js routes, server actions, anything
// short-lived. Prepared statements are disabled because Supavisor in
// transaction mode releases backends between transactions ([R17]).
//
// For the worker (Inngest function bodies, PostgresSaver, NSW VG ingest)
// see ./client-worker.ts.

import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Lazy init: `next build` imports route modules to collect page data, so the
// connection (and its DATABASE_URL check) must NOT run at import time — the var
// is a runtime need, injected by the host, not required to build. The clear
// error still fires on first real use if it is genuinely missing.
let cached: PostgresJsDatabase<typeof schema> | null = null;

function getDb(): PostgresJsDatabase<typeof schema> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Required for the Next.js runtime client.');
  }
  // `prepare: false` is mandatory in transaction-mode pooling.
  // `max: 1` avoids the pool keeping idle connections open in serverless cold-paths;
  // each function invocation gets one backend for the lifetime of its handler.
  const client = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // Serverless-friendly: don't try to fetch types lazily during the function
    // lifetime; cache them once at module init.
    fetch_types: false,
  });
  cached = drizzle(client, { schema });
  return cached;
}

// A Proxy keeps the `db` import shape unchanged for every call site while
// deferring construction to first property access (first query).
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
export { schema };
