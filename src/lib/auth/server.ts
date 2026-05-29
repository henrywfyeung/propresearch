// Supabase server client — for Route Handlers and Server Components.
// Uses the new publishable key (CLAUDE.md §16.1). Cookie bridge uses the
// 0.5.x getAll/setAll API (single-arg setAll; the headers-second-arg form
// and getClaims() are newer than our pinned @supabase/ssr 0.5.2).

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll throws when called from a Server Component (read-only
            // cookies). Safe to ignore — the middleware refreshes sessions.
          }
        },
      },
    },
  );
}
