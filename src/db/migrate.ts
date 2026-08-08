// Migration runner. Invoked via `pnpm db:migrate`.
// Reads .env.local for DATABASE_URL and applies SQL files from
// src/db/migrations/ in lexical order via Drizzle's stock migrator.

import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

loadEnv({ path: '.env.local' });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const client = postgres(url, { max: 1, idle_timeout: 0 });
const db = drizzle(client);

try {
  process.stdout.write('Applying migrations from src/db/migrations …\n');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  process.stdout.write('Migrations applied.\n');
  await client.end({ timeout: 5 });
  process.exit(0);
} catch (err) {
  console.error('Migration failed:', err);
  await client.end({ timeout: 5 });
  process.exit(1);
}
