import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

function loginError(request: NextRequest, message: string) {
  return NextResponse.redirect(
    new URL(`/auth/login?error=${encodeURIComponent(message)}`, request.url)
  )
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error_description') || searchParams.get('error')

  if (oauthError) {
    console.error('OAuth error from Entra:', oauthError)
    return loginError(request, oauthError)
  }

  if (!code) {
    return loginError(request, 'No authorization code received')
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError || !data.session) {
    console.error('Code exchange failed:', exchangeError?.message)
    return loginError(request, exchangeError?.message || 'Sign-in failed')
  }

  const { user, provider_token: providerToken } = data.session

  // Graph needs the Microsoft token, not the Supabase JWT
  let jobTitle: string | null = null
  if (providerToken) {
    const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=jobTitle', {
      headers: { Authorization: `Bearer ${providerToken}` },
    })
    if (graphResponse.ok) {
      jobTitle = (await graphResponse.json()).jobTitle ?? null
    } else {
      console.error('Microsoft Graph error:', graphResponse.status, await graphResponse.text())
    }
  } else {
    console.error('No provider_token on session')
  }

  const { data: allowed } = jobTitle
    ? await supabase
        .from('job_titles')
        .select('role')
        .eq('enabled', true)
        .eq('title', jobTitle)
        .maybeSingle()
    : { data: null }

  if (!allowed) {
    console.warn('Unauthorized job title:', jobTitle, 'for', user.email)
    await supabase.auth.signOut()
    return loginError(
      request,
      `Your job title (${jobTitle ?? 'unknown'}) is not authorized to access this application`
    )
  }

  // The role is written with the server-side key so users can never set their own.
  // Fail closed: if the profile can't be saved, don't leave them signed in without a role.
  let upsertError: unknown = null
  try {
    const { error } = await createAdminClient().from('user_profiles').upsert({
      id: user.id,
      email: user.email ?? '',
      job_title: jobTitle,
      role: allowed.role,
      entra_id: user.id,
    })
    upsertError = error
  } catch (e) {
    upsertError = e
  }
  if (upsertError) {
    console.error('Error upserting user profile:', upsertError)
    await supabase.auth.signOut()
    return loginError(request, 'Sign-in could not be completed. Please contact an administrator.')
  }

  return NextResponse.redirect(new URL('/', request.url))
}
