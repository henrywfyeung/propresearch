// scripts/grant-runtime.ts — make migrated tables visible to the runtime SAs.
//
// Cloud SQL tables are owned by whichever role created them. Migrations run as
// propsearch-ci, so without this the runtime service accounts can connect but
// every query fails with "permission denied for table". fungi hit exactly this
// (see its docs/GCP_RESOURCES.md §2); the deploy pipeline runs this right after
// db:migrate so a new table can never ship unreadable.
//
// Idempotent: GRANT and ALTER DEFAULT PRIVILEGES can both be re-applied safely.
// ALTER DEFAULT PRIVILEGES covers tables created by FUTURE migrations, so this
// script does not need editing when the schema grows.

import 'dotenv/config';
import postgres from 'postgres';

const RUNTIME_ROLES = ['propsearch-web@fungi-family.iam', 'propsearch-worker@fungi-family.iam'];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (Cloud SQL Auth Proxy in CI, or .env.local).');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 0, connect_timeout: 10 });

  try {
    // Role names are compile-time constants, never user input, so identifier
    // interpolation here is safe. Postgres has no bind-parameter form for
    // identifiers in GRANT, so unsafe() is the only option regardless.
    for (const role of RUNTIME_ROLES) {
      // Existing objects.
      await sql.unsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await sql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
      );
      await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);

      // Objects created by future migrations run as the current role.
      await sql.unsafe(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public
           GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
      );
      await sql.unsafe(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public
           GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`,
      );

      console.log(`granted: ${role}`);
    }
    console.log('grant-runtime: done');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
