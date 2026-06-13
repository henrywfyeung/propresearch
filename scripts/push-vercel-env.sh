#!/usr/bin/env bash
# Push production runtime env vars from .env.local into the linked Vercel project.
# Run ONCE in a terminal where you've done `vercel login` (and `vercel link`).
# Re-runnable: removes + re-adds each var so values stay in sync. Values are
# never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
TARGET="production"

# The 16 vars the deployed app needs (NOT Inngest — its Vercel integration adds
# those; NOT the CLI-only/tuning vars).
VARS=(
  DATABASE_URL WORKER_DATABASE_URL
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  OPENAI_API_KEY OPENAI_MODEL_REASONING OPENAI_MODEL_COMPOSE OPENAI_MODEL_VISION
  RAPIDAPI_KEY RAPIDAPI_REA_HOST MAPBOX_TOKEN GOOGLE_MAPS_KEY
  S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET S3_REGION
)
# Pushed only if present + non-empty in .env.local.
OPTIONAL=( ANTHROPIC_API_KEY ANTHROPIC_MODEL_FALLBACK S3_ENDPOINT )

[ -f "$ENV_FILE" ] || { echo "error: $ENV_FILE not found (run from the project)"; exit 1; }
command -v vercel >/dev/null || { echo "error: vercel CLI not installed"; exit 1; }
vercel whoami >/dev/null 2>&1 || { echo "error: not logged in — run 'vercel login' first"; exit 1; }

get_val() {
  local line val
  line=$(grep -E "^$1=" "$ENV_FILE" | head -1 || true)
  val="${line#*=}"
  val="${val%\"}"; val="${val#\"}"   # strip "  "
  val="${val%\'}"; val="${val#\'}"   # strip '  '
  printf '%s' "$val"
}

push() {
  local name val
  name="$1"; val="$(get_val "$name")"
  if [ -z "$val" ]; then echo "skip  $name (empty/absent)"; return; fi
  vercel env rm "$name" "$TARGET" --yes >/dev/null 2>&1 || true
  printf '%s' "$val" | vercel env add "$name" "$TARGET" >/dev/null
  echo "set   $name"
}

echo "Pushing env vars to Vercel ($TARGET)…"
for v in "${VARS[@]}";     do push "$v"; done
for v in "${OPTIONAL[@]}"; do push "$v"; done
echo "Done. Review with:  vercel env ls"
