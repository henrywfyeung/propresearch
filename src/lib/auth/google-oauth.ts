// src/lib/auth/google-oauth.ts — server-side Google OAuth 2.0 authorization-code flow.
//
// Replaces Supabase Auth. Deliberately server-side: the browser never sees a
// client id or holds a token, so there is no NEXT_PUBLIC_* value to bake into
// the image at build time.
//
// Deliberately NOT Firebase Identity Platform: a Firebase project *is* a GCP
// project, so Firebase Auth here would share one user pool with fungi, whose
// fail-closed blocking functions reject any email absent from
// core.allowed_emails. Plain OAuth keeps the two apps' identities separate.

import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

export const STATE_COOKIE = '__propsearch_oauth_state';
export const NONCE_COOKIE = '__propsearch_oauth_nonce';

/** OAuth handshake cookies are short-lived; 10 minutes is ample for a sign-in. */
export const handshakeCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 600,
};

function clientId(): string {
  const value = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!value) throw new Error('GOOGLE_OAUTH_CLIENT_ID is not set');
  return value;
}

function clientSecret(): string {
  const value = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!value) throw new Error('GOOGLE_OAUTH_CLIENT_SECRET is not set');
  return value;
}

export function redirectUriFor(origin: string): string {
  return `${origin}/auth/callback`;
}

function oauthClient(origin: string): OAuth2Client {
  return new OAuth2Client({
    clientId: clientId(),
    clientSecret: clientSecret(),
    redirectUri: redirectUriFor(origin),
  });
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Build the Google consent URL.
 *
 * `state` defends against CSRF on the callback; `nonce` is echoed inside the
 * signed ID token, which binds the token to this specific request and stops a
 * token minted for another session being replayed here.
 */
export function buildAuthUrl(origin: string, state: string, nonce: string): string {
  return oauthClient(origin).generateAuthUrl({
    scope: ['openid', 'email'],
    state,
    nonce,
    // We only ever need the ID token; no refresh token, so no offline access
    // and nothing long-lived to store.
    access_type: 'online',
    prompt: 'select_account',
  });
}

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  sub: string;
}

/**
 * Exchange the authorization code and verify the resulting ID token.
 *
 * Verification asserts the signature, that `aud` is our client id and `iss` is
 * Google (both handled by verifyIdToken), plus that the nonce matches what we
 * issued. Returns null on any failure — callers must not distinguish causes to
 * the user.
 */
export async function exchangeCodeForIdentity(
  origin: string,
  code: string,
  expectedNonce: string,
): Promise<GoogleIdentity | null> {
  const client = oauthClient(origin);

  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) return null;

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: clientId(),
  });

  const payload = ticket.getPayload();
  if (!payload?.email || !payload.sub) return null;
  if (payload.nonce !== expectedNonce) return null;

  return {
    email: payload.email,
    // Google sets this false for some workspace edge cases; an unverified
    // address must never satisfy an allow-list keyed on email.
    emailVerified: payload.email_verified === true,
    sub: payload.sub,
  };
}
