import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit .next/standalone so the runtime image carries only the server and the
  // node_modules it actually traced, instead of the whole dependency tree.
  output: 'standalone',
  // puppeteer-core must not be bundled — it resolves a browser binary at
  // runtime from CHROME_PATH, which the worker image installs.
  serverExternalPackages: ['puppeteer-core'],
  // typedRoutes graduated from `experimental` to a stable top-level option in
  // Next 15.5.
  typedRoutes: true,
};

// Wrap with the Sentry build plugin only when a DSN is configured — keeps the
// plugin (client-config injection, source-map upload) out of the build until
// Sentry is set up. Source-map upload additionally needs SENTRY_ORG/PROJECT/
// AUTH_TOKEN; without them it's skipped (a warning, not an error).
export default process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      widenClientFileUpload: true,
      disableLogger: true,
    })
  : nextConfig;
