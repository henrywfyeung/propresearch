import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Puppeteer + @sparticuz/chromium-min can't be bundled — leave them external.
  // chromium-min downloads the Chromium pack at runtime (see src/report/pdf.ts),
  // so there's nothing to outputFileTracingIncludes — that path (bundling the
  // libs from the package) fought Next tracing + pnpm symlinks and never landed.
  serverExternalPackages: ['@sparticuz/chromium-min', 'puppeteer-core'],
  // typedRoutes graduated from `experimental` to a stable top-level option in
  // Next 15.5.
  typedRoutes: true,
  // Allowlist Domain photo CDN + Street View + R2 for any future <Image> usage.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.domain.com.au' },
      { protocol: 'https', hostname: 'maps.googleapis.com' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
    ],
  },
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
