# Two runtime images from one build, selected with --target:
#
#   docker build --target web    -t .../propsearch-web    .
#   docker build --target worker -t .../propsearch-worker .
#
# They share the `builder` stage, so the Next.js build runs once. Only the
# worker installs Chromium (~500MB) — keeping it out of the web image is the
# whole reason the services are split, since the dashboard would otherwise
# cold-start behind a needlessly large pull.

# ---------------------------------------------------------------------------
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# --frozen-lockfile: CI must fail on a stale lockfile rather than silently
# resolving something the developer never tested.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No build-time secrets: auth is a server-side OAuth flow, so there is no
# NEXT_PUBLIC_* client id to inline. The only NEXT_PUBLIC_ value the app can
# take is a Sentry DSN, which is absent today.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---------------------------------------------------------------------------
# Shared runtime scaffolding for both final images.
FROM base AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

EXPOSE 8080

# ---------------------------------------------------------------------------
# Web: pages, /api/reports, /auth/*, /reports/[id]/pdf. No browser needed.
FROM runtime-base AS web
USER nextjs
CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
# Worker: serves /api/inngest and renders PDFs, so it needs a real browser.
#
# Installing Debian's chromium replaces the entire @sparticuz/chromium-min
# arrangement: no ~50MB pack downloaded from GitHub releases on every cold
# start, no LD_LIBRARY_PATH patching, and no dependency on
# AWS_LAMBDA_JS_RUNTIME containing the substring "20.x".
FROM runtime-base AS worker
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium
USER nextjs
CMD ["node", "server.js"]
