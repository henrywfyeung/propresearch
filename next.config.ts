import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Puppeteer + @sparticuz/chromium can't be bundled — leave them external.
  // See CLAUDE.md §13.3, §16.2 / [R28] for the render-route memory pin.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  // @sparticuz/chromium ships Chromium + its shared libs (libnss3.so, …) as
  // brotli files under bin/, loaded at RUNTIME — so Next's file-tracing misses
  // them and the deployed function can't launch Chromium ("libnss3.so: cannot
  // open shared object file"). Force-include them in the function that renders
  // the PDF: the graph's Node 13 runs inside the Inngest handler at /api/inngest.
  //
  // Point at the REAL .pnpm path, NOT node_modules/@sparticuz/chromium (a pnpm
  // symlink) — tracing through the symlink makes Vercel reject the package with
  // "invalid deployment package … files in symlinked directories". The version
  // glob keeps it working across @sparticuz/chromium bumps.
  outputFileTracingIncludes: {
    '/api/inngest': [
      './node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**',
    ],
  },
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

export default nextConfig;
