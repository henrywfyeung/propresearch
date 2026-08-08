// tests/unit/session.test.ts — the signed session cookie.
//
// This code is hand-rolled and replaces Supabase's session handling, so the
// adversarial cases matter more than the happy path: a forged or expired cookie
// must never verify.

import {
  SESSION_COOKIE,
  clearedCookieOptions,
  sessionCookieOptions,
  signSession,
  verifySession,
} from '@/lib/auth/session';
import { beforeEach, describe, expect, it } from 'vitest';

const SECRET = 'a'.repeat(48);

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe('signSession / verifySession round trip', () => {
  it('verifies a freshly signed cookie and returns the payload', async () => {
    const token = await signSession({ uid: 'user-1', email: 'a@example.com' });
    const payload = await verifySession(token);

    expect(payload).not.toBeNull();
    expect(payload?.uid).toBe('user-1');
    expect(payload?.email).toBe('a@example.com');
  });

  it('sets an expiry 7 days out', async () => {
    const now = 1_700_000_000_000;
    const payload = await verifySession(
      await signSession({ uid: 'u', email: 'a@example.com' }, now),
      now,
    );
    expect(payload?.exp).toBe(Math.floor(now / 1000) + 7 * 24 * 60 * 60);
  });
});

describe('rejection cases', () => {
  it('rejects undefined (no cookie present)', async () => {
    expect(await verifySession(undefined)).toBeNull();
  });

  it('rejects a malformed token with no separator', async () => {
    expect(await verifySession('not-a-token')).toBeNull();
  });

  it('rejects an empty signature', async () => {
    expect(await verifySession('payload.')).toBeNull();
  });

  it('rejects a tampered payload — the core forgery case', async () => {
    const token = await signSession({ uid: 'user-1', email: 'a@example.com' });
    const [, sig] = token.split('.');

    // Re-encode a payload claiming to be someone else, keeping the old signature.
    const forged = Buffer.from(
      JSON.stringify({ uid: 'admin', email: 'admin@example.com', exp: 9_999_999_999 }),
    ).toString('base64url');

    expect(await verifySession(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession({ uid: 'user-1', email: 'a@example.com' });
    process.env.SESSION_SECRET = 'b'.repeat(48);
    expect(await verifySession(token)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const signedAt = 1_700_000_000_000;
    const token = await signSession({ uid: 'u', email: 'a@example.com' }, signedAt);
    // 8 days later.
    const later = signedAt + 8 * 24 * 60 * 60 * 1000;
    expect(await verifySession(token, later)).toBeNull();
  });

  it('accepts a token one second before expiry', async () => {
    const signedAt = 1_700_000_000_000;
    const token = await signSession({ uid: 'u', email: 'a@example.com' }, signedAt);
    const justBefore = signedAt + 7 * 24 * 60 * 60 * 1000 - 1000;
    expect(await verifySession(token, justBefore)).not.toBeNull();
  });

  it('rejects a validly-signed token whose payload lacks required fields', async () => {
    // Signed with the real secret but structurally wrong — guards against a
    // payload shape change silently authenticating someone.
    const { createHmac } = await import('node:crypto');
    const payload = Buffer.from(JSON.stringify({ exp: 9_999_999_999 })).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');

    expect(await verifySession(`${payload}.${sig}`)).toBeNull();
  });
});

describe('secret validation', () => {
  it('refuses to sign when SESSION_SECRET is unset', async () => {
    process.env.SESSION_SECRET = '';
    await expect(signSession({ uid: 'u', email: 'a@example.com' })).rejects.toThrow(
      'SESSION_SECRET',
    );
  });

  it('refuses a secret shorter than 32 characters', async () => {
    process.env.SESSION_SECRET = 'too-short';
    await expect(signSession({ uid: 'u', email: 'a@example.com' })).rejects.toThrow(
      'at least 32 characters',
    );
  });

  it('returns null rather than throwing when verifying without a secret', async () => {
    const token = await signSession({ uid: 'u', email: 'a@example.com' });
    process.env.SESSION_SECRET = '';
    // Middleware calls this on every request; it must fail closed, not 500.
    expect(await verifySession(token)).toBeNull();
  });
});

describe('cookie options', () => {
  it('is httpOnly, lax, and root-scoped', () => {
    expect(sessionCookieOptions.httpOnly).toBe(true);
    expect(sessionCookieOptions.sameSite).toBe('lax');
    expect(sessionCookieOptions.path).toBe('/');
  });

  it('clears with a zero lifetime but otherwise identical attributes', () => {
    expect(clearedCookieOptions.maxAge).toBe(0);
    expect(clearedCookieOptions.httpOnly).toBe(true);
    expect(clearedCookieOptions.path).toBe(sessionCookieOptions.path);
  });

  it('uses a namespaced cookie name so it cannot collide with fungi on a shared domain', () => {
    expect(SESSION_COOKIE).toBe('__propsearch_session');
  });
});
