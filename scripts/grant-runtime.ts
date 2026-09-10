// scripts/grant-runtime.ts — make migrated tables visible to the runtime SAs.
//
// Cloud SQL tables are owned by whichever role created them. Migrations run as
// propsearch-ci, so without this the runtime service accounts can connect but
// every query fails with "permission denied for table". fungi hit exactly this
// (see its docs/GCP_RESOURCES.md §2); the deploy pipeline runs this right after
// db:migrate so a new table can never ship unreadable.
//
// Idempotent: GRANT and ALTER DEFAULT PRIVILEGES can both be re-applied safely.
//
// The FOR ROLE clause matters and is easy to get wrong. ALTER DEFAULT
// PRIVILEGES without it attaches the rule to whoever RUNS this script; if that
// is an admin or a throwaway bootstrap user rather than the migrator, then
// tables created by future CI migrations inherit nothing and the next deploy
// breaks. Naming MIGRATOR_ROLE explicitly makes the result independent of who
// executes it. (This bug was live briefly during the migration and is why the
// clause is here.)

import 'dotenv/config';
import postgres from 'postgres';

/** The role that owns migrated objects — i.e. whoever runs db:migrate in CI. */
const MIGRATOR_ROLE = 'propsearch-ci@fungi-family.iam';

const RUNTIME_ROLES = ['propsearch-web@fungi-family.iam', 'propsearch-worker@fungi-family.iam'];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (Cloud SQL Auth Proxy in CI, or .env.local).');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 0, connect_timeout: 10, onnotice: () => {} });

  try {
    // Role names are compile-time constants, never user input, so identifier
    // interpolation is safe. Postgres has no bind-parameter form for
    // identifiers in GRANT, so unsafe() is the only option regardless.
    for (const role of RUNTIME_ROLES) {
      // NOTE: schema-level USAGE is deliberately NOT granted here. It is a
      // one-time bootstrap concern requiring a cloudsqlsuperuser (see
      // scripts/bootstrap-db-grants.sql); attempting it from the migrator role
      // is a silent no-op that emits a confusing "no privileges were granted
      // for public" notice on every deploy. This script owns table and
      // sequence privileges only.
      await sql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
      );
      await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);

      // Objects created by FUTURE migrations run as MIGRATOR_ROLE.
      await sql.unsafe(
        `ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATOR_ROLE}" IN SCHEMA public
           GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
      );
      await sql.unsafe(
        `ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATOR_ROLE}" IN SCHEMA public
           GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`,
      );

      console.log(`granted: ${role}`);
    }

    // Fail loudly if the default privileges did not land on the migrator, which
    // is the silent-breakage case this script exists to prevent.
    const attributed = await sql`
      SELECT DISTINCT d.defaclrole::regrole::text AS role FROM pg_default_acl d`;
    const roles = attributed.map((r) => (r as { role: string }).role.replace(/"/g, ''));
    if (roles.length && !roles.includes(MIGRATOR_ROLE)) {
      throw new Error(
        `Default privileges are attributed to ${roles.join(', ')}, not ${MIGRATOR_ROLE}. ` +
          'Future migrations would create tables the runtimes cannot read.',
      );
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
