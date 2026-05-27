-- Hand-written follow-up to Drizzle's autogen. Adds the things drizzle-kit
-- can't generate cleanly:
--   1. pg_trgm extension + GIN trigram index on reports.subject_address
--      (for the E5 dashboard ILIKE search, [R25]).
--   2. PostGIS geometry column on nsw_vg_sales + GIST index
--      (for the Tier-2 spatial comp search in Node 03, CLAUDE.md §7.3).
--
-- postgis + uuid-ossp were enabled before any migrations ran (see
-- CLAUDE.md §4.1 / Phase A2 setup). This file is idempotent.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- E5 trigram search on the denormalised subject_address column.
CREATE INDEX IF NOT EXISTS "reports_subject_address_trgm_idx"
  ON "reports"
  USING gin (subject_address gin_trgm_ops)
  WHERE subject_address IS NOT NULL;

-- PostGIS Point geometry in SRID 4326 (WGS 84). Nullable while the table
-- is being populated; the NSW VG ingest cron sets it via ST_MakePoint.
ALTER TABLE "nsw_vg_sales"
  ADD COLUMN IF NOT EXISTS "geom" geometry(Point, 4326);

CREATE INDEX IF NOT EXISTS "nsw_vg_sales_geom_idx"
  ON "nsw_vg_sales"
  USING gist ("geom");
