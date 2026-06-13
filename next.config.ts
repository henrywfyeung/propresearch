import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Puppeteer + @sparticuz/chromium can't be bundled — leave them external.
  // See CLAUDE.md §13.3, §16.2 / [R28] for the render-route memory pin.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
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
