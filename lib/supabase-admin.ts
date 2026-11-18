import { createClient } from '@supabase/supabase-js'

// Server-only client that bypasses RLS. Never import this from a client component
// and never give the key a NEXT_PUBLIC_ prefix. Used only to write trusted data
// (e.g. a user's role) that users must not be able to set themselves.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (server-side only)')
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
