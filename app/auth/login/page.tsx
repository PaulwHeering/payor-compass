'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Check if already logged in
    const checkUser = async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        router.push('/')
      }
    }
    checkUser()
  }, [router])

  const handleEntraLogin = async () => {
    setLoading(true)
    setError(null)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
          scopes: 'openid profile email',
        },
      })
      if (error) throw error
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-xl shadow-lg p-8 border border-slate-200">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Payer Compass</h1>
            <p className="text-slate-600">Insurance Payer Management</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            onClick={handleEntraLogin}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors mb-4 flex items-center justify-center gap-2"
          >
            {loading ? 'Signing in...' : 'Sign in with Entra'}
          </button>

          <p className="text-center text-sm text-slate-500 mt-6">
            Sign in with your organizational account
          </p>
        </div>

        <div className="mt-8 p-6 bg-white rounded-xl shadow border border-slate-200">
          <p className="text-sm text-slate-600 text-center">
            Only members of your organization can access this application
          </p>
        </div>
      </div>
    </main>
  )
}
