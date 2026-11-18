import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.redirect(
        new URL('/auth/login?error=missing_env', request.url)
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // Exchange code for session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      return NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent(error.message)}`, request.url)
      )
    }

    if (data.session?.user) {
      const user = data.session.user
      const jobTitle = user.user_metadata?.job_title || null
      const email = user.email || ''

      // Check if user's job title is allowed
      const { data: allowedJobTitles } = await supabase
        .from('job_titles')
        .select('title, role')
        .eq('enabled', true)
        .eq('title', jobTitle)

      if (!allowedJobTitles || allowedJobTitles.length === 0) {
        // Job title not found or not enabled - deny access
        await supabase.auth.signOut()
        return NextResponse.redirect(
          new URL(
            `/auth/login?error=${encodeURIComponent('Your job title is not authorized to access this application')}`,
            request.url
          )
        )
      }

      // Create or update user profile
      const userRole = allowedJobTitles[0].role
      await supabase.from('user_profiles').upsert({
        id: user.id,
        email,
        job_title: jobTitle,
        role: userRole,
        entra_id: user.id,
      })
    }
  }

  return NextResponse.redirect(new URL('/', request.url))
}
