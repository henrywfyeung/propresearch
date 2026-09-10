-- One-time database bootstrap for a platform app. Run ONCE per app.
--
-- WHY THIS EXISTS
-- Cloud SQL IAM users are members of `cloudsqliamuser` only. Since PostgreSQL
-- 15 the `public` schema no longer grants CREATE to everyone, and the database
-- is owned by `cloudsqlsuperuser`, so an IAM principal can connect but cannot
-- create a table. `pnpm db:migrate` therefore fails with:
--
--     error: permission denied for schema public (SQLSTATE 42501)
--
-- Nothing in Terraform or gcloud can fix it: SQL-level privileges are only
-- grantable from inside Postgres. fungi solved this the same way -- in its
-- database `fungi-ci@fungi-family.iam` already holds CREATE.
--
-- ---------------------------------------------------------------------------
-- YOU DO NOT NEED THE `postgres` PASSWORD
-- ---------------------------------------------------------------------------
-- Cloud SQL grants `cloudsqlsuperuser` to ANY user created through the Admin
-- API. So mint a temporary one, use it, and delete it -- the `postgres`
-- credential is never touched:
--
--   PW=$(openssl rand -base64 36 | tr -d '\n')
--   gcloud sql users create tmp-bootstrap --instance=fungi-db \
--     --project=fungi-family --password="$PW"
--
--   cloud-sql-proxy --port 55432 fungi-family:asia-southeast1:fungi-db &
--   #   NB: no --auto-iam-authn; that flag forces IAM auth and this user has
--   #   a password.
--   PGPASSWORD="$PW" psql \
--     "postgresql://tmp-bootstrap@127.0.0.1:55432/<appdb>?sslmode=disable" \
--     -f scripts/bootstrap-db-grants.sql
--
--   gcloud sql users delete tmp-bootstrap --instance=fungi-db \
--     --project=fungi-family --quiet
--
-- TWO TRAPS, both hit for real during the propsearch migration:
--
--  1. `cloudsqlsuperuser` is NOT a true superuser. `REASSIGN OWNED ... TO r`
--     fails with "Only roles with privileges of role r may reassign objects to
--     it" unless the temp user is first granted membership in r. The GRANT
--     below handles that.
--
--  2. Delete the temp user LAST, and run `DROP OWNED BY` first. Any default-ACL
--     entry it created counts as a dependent object and blocks the delete with
--     "role cannot be dropped because some objects depend on it".
-- ---------------------------------------------------------------------------

-- Substitute the app's roles throughout.

-- Let CI create the objects it migrates.
GRANT CREATE, USAGE ON SCHEMA public TO "propsearch-ci@fungi-family.iam";

-- Runtimes need to reach objects in the schema but must never create them:
-- migrations are CI's job, and a runtime that can DDL is a runtime that can
-- silently diverge from the checked-in schema. Table-level privileges are NOT
-- granted here -- `pnpm db:grant` owns those, on every deploy.
GRANT USAGE ON SCHEMA public TO "propsearch-web@fungi-family.iam";
GRANT USAGE ON SCHEMA public TO "propsearch-worker@fungi-family.iam";

-- Let the human operator administer the database as themselves, so routine work
-- never needs another throwaway superuser. Membership in the CI role also
-- confers ownership rights over migrated tables.
GRANT CREATE, USAGE ON SCHEMA public TO "henrywfyeung@gmail.com";
GRANT "propsearch-ci@fungi-family.iam" TO "henrywfyeung@gmail.com";

-- Required before REASSIGN OWNED (trap 1 above). Harmless if you migrate as CI
-- directly rather than as this temp user.
GRANT "propsearch-ci@fungi-family.iam" TO CURRENT_USER;

-- If the first migration was run by this temp user rather than by CI, hand the
-- objects over so future CI migrations can ALTER them:
--
--   REASSIGN OWNED BY CURRENT_USER TO "propsearch-ci@fungi-family.iam";

-- Verify: CREATE true for CI and the operator, false for both runtimes.
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
