// src/lib/auth/session.ts — HMAC-signed session cookie.
//
// Replaces Supabase's session handling. The important property versus what it
// replaces: verification is local, so middleware no longer makes an HTTPS call
// to an auth server on every single request.
//
// Built on Web Crypto rather than node:crypto because Next.js middleware runs
// on the Edge runtime even when the app is hosted on Cloud Run, and node:crypto
// is unavailable there. Web Crypto exists in both runtimes; the cost is that
// signing and verifying are async.
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
// The payload is signed, not encrypted — it holds only a user id, an email and
// an expiry, none of which are secret from the user who owns them. What matters
// is that it cannot be forged.

export const SESSION_COOKIE = '__propsearch_session';

/** 7 days. Long enough to avoid nagging a single daily user, short enough to bound a stolen cookie. */
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface SessionPayload {
  /** Local `users` row id. */
  uid: string;
  email: string;
  /** Unix seconds. */
  exp: number;
}

function secretBytes(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error('SESSION_SECRET is not set');
  if (value.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(value);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmac(payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes(),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return toBase64Url(new Uint8Array(sig));
}

/** Constant-time string comparison — no early exit on first differing byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(
  input: Omit<SessionPayload, 'exp'>,
  now = Date.now(),
): Promise<string> {
  const payload: SessionPayload = { ...input, exp: Math.floor(now / 1000) + MAX_AGE_SECONDS };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${payloadB64}.${await hmac(payloadB64)}`;
}

/**
 * Returns the payload, or null for anything not currently valid: malformed,
 * wrong signature, or expired. Callers treat null as "not signed in" — there is
 * deliberately no way to distinguish forged from expired at the call site.
 */
export async function verifySession(
  token: string | undefined,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (!token) return null;

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let expectedSig: string;
  try {
    expectedSig = await hmac(payloadB64);
  } catch {
    return null;
  }
  if (!safeEqual(providedSig, expectedSig)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  } catch {
    return null;
  }

  if (typeof payload?.uid !== 'string' || typeof payload?.email !== 'string') return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;

  return payload;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE_SECONDS,
};

/** Options for clearing the cookie — same attributes, zero lifetime. */
export const clearedCookieOptions = { ...sessionCookieOptions, maxAge: 0 };
