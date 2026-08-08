// src/lib/auth/origin.ts — determine this request's public origin.
//
// Cloud Run terminates TLS at the front end and forwards to the container over
// plain HTTP, so `request.url` can carry the internal scheme/host. OAuth breaks
// noisily when that happens: the redirect_uri we send to Google must match the
// one registered on the client exactly. Prefer the forwarded headers.

import type { NextRequest } from 'next/server';

export function requestOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');

  if (forwardedHost) {
    const proto = forwardedProto?.split(',')[0]?.trim() || 'https';
    return `${proto}://${forwardedHost.split(',')[0]?.trim()}`;
  }

  const host = request.headers.get('host');
  if (host) {
    // Anything that is not localhost is assumed to be served over TLS.
    const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}
