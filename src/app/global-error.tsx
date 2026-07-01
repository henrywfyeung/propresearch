'use client';

// Global error boundary — reports uncaught React render errors to Sentry (no-op
// without a DSN) and shows a minimal fallback. Next 15 / Sentry recommended.
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem', color: '#0A0A0A' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Something went wrong</h2>
        <p style={{ fontSize: '0.875rem', color: '#555' }}>
          An unexpected error occurred. Please refresh the page or try again.
        </p>
      </body>
    </html>
  );
}
