// Supabase browser client — for Client Components (e.g. the Google sign-in
// button). Only ever uses the publishable key, which is safe to ship to the
// browser.
'use client';

import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
