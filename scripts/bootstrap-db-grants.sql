-- One-time database bootstrap for propsearch. Run ONCE, as `postgres`.
--
-- WHY THIS EXISTS
-- Cloud SQL IAM users are members of `cloudsqliamuser` only. Since PostgreSQL
-- 15 the `public` schema no longer grants CREATE to everyone, and the database
-- is owned by `cloudsqlsuperuser`, so an IAM principal can connect but cannot
-- create a table. `pnpm db:migrate` therefore fails with:
--
--     error: permission denied for schema public (SQLSTATE 42501)
--
-- fungi solved this the same way; in its database `fungi-ci@fungi-family.iam`
-- already has CREATE, granted by exactly this kind of one-time bootstrap.
-- Nothing in Terraform or gcloud can do it: SQL-level privileges are only
-- grantable from inside Postgres, and only a member of cloudsqlsuperuser can
-- make the first grant.
--
-- EVERY NEW PLATFORM APP NEEDS THIS ONCE, with the names substituted.
--
-- HOW TO RUN
--   1. Start the proxy:
--        cloud-sql-proxy --port 55432 fungi-family:asia-southeast1:fungi-db
--   2. Connect as the superuser (password held out-of-band):
--        psql "postgresql://postgres@127.0.0.1:55432/propsearch"
--   3. \i scripts/bootstrap-db-grants.sql
--
-- Note step 1 omits --auto-iam-authn: that flag forces IAM auth, and `postgres`
-- authenticates with a password.

-- Let CI create and own the schema objects it migrates.
GRANT CREATE, USAGE ON SCHEMA public TO "propsearch-ci@fungi-family.iam";

-- Let CI hand read/write on those objects to the runtime accounts afterwards.
-- Without this, `pnpm db:grant` runs but grants nothing it is allowed to grant.
GRANT "propsearch-ci@fungi-family.iam" TO "postgres";

-- Runtimes need to reach objects in the schema, but must never create them:
-- migrations are CI's job, and a runtime that can DDL is a runtime that can
-- silently diverge from the checked-in schema.
GRANT USAGE ON SCHEMA public TO "propsearch-web@fungi-family.iam";
GRANT USAGE ON SCHEMA public TO "propsearch-worker@fungi-family.iam";

-- Convenience for hand-run migrations and psql debugging from a laptop.
-- Drop this line if you would rather all DDL go through CI.
GRANT CREATE, USAGE ON SCHEMA public TO "henrywfyeung@gmail.com";

-- Verify: all three should report true for the CI and admin principals, and
-- false for the two runtime accounts.
SELECT rolname,
       has_schema_privilege(rolname, 'public', 'CREATE') AS can_create,
       has_schema_privilege(rolname, 'public', 'USAGE')  AS can_use
FROM pg_roles
WHERE rolname IN (
  'propsearch-ci@fungi-family.iam',
  'propsearch-web@fungi-family.iam',
  'propsearch-worker@fungi-family.iam',
  'henrywfyeung@gmail.com'
)
ORDER BY rolname;
