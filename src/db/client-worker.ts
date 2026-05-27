// Session-mode pool — used by:
//   - Inngest worker functions (graph node bodies)
//   - LangGraph PostgresSaver checkpointer
//   - NSW VG bulk ingest cron
//
// CLAUDE.md §16.3 / [R17] — session mode keeps prepared statements alive
// between transactions, which Drizzle's `postgres-js` driver and
// LangGraph's checkpointer both require.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.WORKER_DATABASE_URL;
if (!url) {
  throw new Error('WORKER_DATABASE_URL is not set. Required for the worker client.');
}

// Session mode allows prepared statements (default) and lets us hold a
// larger pool — a single long-lived Inngest worker process is the consumer,
// so we don't pay the cold-start tax that pushed us to prepare:false on
// the transaction-mode client.
const client = postgres(url, {
  max: 8, // long-lived worker process; keep modest pool
  idle_timeout: 0, // never drop idle connections — worker holds the pool
  connect_timeout: 10,
});

export const workerDb = drizzle(client, { schema });
export { client as workerSqlClient, schema };
