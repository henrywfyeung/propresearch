// Session-refresh helper used by the root middleware (Edge runtime).
//
// IMPORTANT — runtime constraint: Next.js 15.0.3 middleware runs on the Edge
// runtime, which can't use the `postgres-js` driver (Node TCP sockets). So
// the allow-list DB re-check (R5) does NOT happen here — it lives in
// `requireAllowedUser()` (Node runtime, Drizzle) called by protected layouts.
// Middleware only does what Edge can: refresh the Supabase session and gate
// unauthenticated traffic to /login. This matches Supabase's own guidance
// (middleware = session refresh; authorization elsewhere). See CLAUDE.md §10.3.

import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_PREFIXES = ['/login', '/auth'];

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do NOT insert logic between createServerClient and getUser — per Supabase,
  // a mistake here can randomly log users out. getUser() verifies the token
  // against Supabase's Auth server (works on Edge; algorithm-agnostic, so the
  // 2025 JWT-signing-keys migration doesn't affect it).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return response;
}
