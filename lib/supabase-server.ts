import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Supabase client for route handlers that acts as the signed-in user (cookie session).
// All database access in research routes goes through this client, so row level security
// still limits what research can do to what a manager or admin is allowed to do.
export async function createUserSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Cookie refresh is best-effort in route handlers.
          }
        },
      },
    }
  )
}

export type UserSupabase = Awaited<ReturnType<typeof createUserSupabase>>

export type ReviewerAuth =
  | { ok: true; supabase: UserSupabase; userId: string; email: string }
  | { ok: false; status: number; message: string }

// Only managers and admins may start research (it spends API credits and writes findings).
export async function requireReviewer(): Promise<ReviewerAuth> {
  const supabase = await createUserSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, message: 'You are not signed in.' }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, email')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'manager' && profile.role !== 'admin')) {
    return { ok: false, status: 403, message: 'Only managers and admins can run research.' }
  }
  return { ok: true, supabase, userId: user.id, email: user.email ?? profile.email ?? '' }
}
