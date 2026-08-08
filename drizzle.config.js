// JS rather than TS because drizzle-kit's TS loader trips on our project's
// ES2023 tsconfig target. Plain JS sidesteps the bundler entirely.
// @ts-check
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required for drizzle-kit. See .env.local.');
}

/** @type {import('drizzle-kit').Config} */
const config = {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
};

export default config;
