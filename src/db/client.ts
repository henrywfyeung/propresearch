// Transaction-mode pool — used by Next.js routes, server actions, anything
// short-lived. Prepared statements are disabled because Supavisor in
// transaction mode releases backends between transactions ([R17]).
//
// For the worker (Inngest function bodies, PostgresSaver, NSW VG ingest)
// see ./client-worker.ts.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

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

export const db = drizzle(client, { schema });
export { schema };
