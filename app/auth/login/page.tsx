'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Binoculars, Compass, Handshake, ReceiptText, Sheet, Signature, type LucideIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import CompassLogo from '@/app/components/CompassLogo'

// Faint glyphs scattered behind the sign-in card: one per cell of a grid, nudged by a fixed pseudo-random
// sequence so the layout is even, looks random, and is identical on the server and in the browser.
const GLYPHS: LucideIcon[] = [Signature, ReceiptText, Compass, Binoculars, Sheet, Handshake]
const COLS = 8
const ROWS = 5
function seeded(seed: number) {
  let x = seed
  return () => {
    x = (x * 16807) % 2147483647
    return (x - 1) / 2147483646
  }
}
const SCATTER = (() => {
  const rand = seeded(42)
  return Array.from({ length: COLS * ROWS }, (_, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    return {
      Icon: GLYPHS[Math.floor(rand() * GLYPHS.length)],
      left: ((col + 0.15 + rand() * 0.7) / COLS) * 100,
      top: ((row + 0.15 + rand() * 0.7) / ROWS) * 100,
      size: Math.round(28 + rand() * 72),
      rotate: Math.round(rand() * 24 - 12),
      // Each glyph wanders its own way: up to ~40px in any direction and a few degrees of turn, over 18-34s.
      dx: Math.round(rand() * 80 - 40),
      dy: Math.round(rand() * 80 - 40),
      turn: Math.round(rand() * 16 - 8),
      delay: -Math.round(rand() * 30),
      duration: Math.round(18 + rand() * 16),
    }
  })
})()

// Glyphs slide away from the mouse pointer when it comes within this distance, by up to PUSH_PX.
const REPEL_RADIUS = 150
const PUSH_PX = 70

// Moves each glyph's inner layer away from the pointer. The outer layer (which drifts) is measured, so the
// push never feeds back into itself. Updates are batched into one animation frame per mouse move.
function useRepel(count: number) {
  const anchors = useRef<(HTMLSpanElement | null)[]>([])
  const layers = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    let pointer: { x: number; y: number } | null = null

    const update = () => {
      frame = 0
      for (let i = 0; i < count; i++) {
        const anchor = anchors.current[i]
        const layer = layers.current[i]
        if (!anchor || !layer) continue
        let transform = ''
        if (pointer) {
          const r = anchor.getBoundingClientRect()
          const dx = r.left + r.width / 2 - pointer.x
          const dy = r.top + r.height / 2 - pointer.y
          // Measure to the glyph's edge, so big glyphs react as the pointer nears them, not just their centre.
          const dist = Math.max(0, Math.hypot(dx, dy) - Math.min(r.width, r.height) / 2)
          if (dist < REPEL_RADIUS) {
            const len = Math.hypot(dx, dy) || 1
            const push = (1 - dist / REPEL_RADIUS) ** 2 * PUSH_PX
            transform = `translate(${((dx / len) * push).toFixed(1)}px, ${((dy / len) * push).toFixed(1)}px)`
          }
        }
        if (layer.style.transform !== transform) layer.style.transform = transform
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      pointer = { x: e.clientX, y: e.clientY }
      schedule()
    }
    const onLeave = () => {
      pointer = null
      schedule()
    }
    window.addEventListener('pointermove', onMove)
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [count])

  return { anchors, layers }
}

export default function LoginPage() {
  const { anchors, layers } = useRepel(SCATTER.length)
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const urlError = new URLSearchParams(window.location.search).get('error')
    if (urlError) setError(urlError)

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
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: 'openid profile email User.Read',
        },
      })
      if (error) throw error
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setLoading(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-white flex items-center justify-center">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {SCATTER.map(({ Icon, left, top, size, rotate, dx, dy, turn, delay, duration }, i) => (
          <span
            key={i}
            ref={el => {
              anchors.current[i] = el
            }}
            className="login-glyph absolute"
            style={
              {
                left: `${left}%`,
                top: `${top}%`,
                '--rotate': `${rotate}deg`,
                '--dx': `${dx}px`,
                '--dy': `${dy}px`,
                '--turn': `${turn}deg`,
                animationDelay: `${delay}s`,
                animationDuration: `${duration}s`,
              } as CSSProperties
            }
          >
            <span
              ref={el => {
                layers.current[i] = el
              }}
              className="block transition-transform duration-700 ease-out"
            >
              <Icon className="text-[#d5e2f3]" style={{ width: size, height: size }} strokeWidth={1.25} />
            </span>
          </span>
        ))}
      </div>

      <div className="relative w-full max-w-sm mx-4 bg-white rounded-xl border border-slate-200 shadow-[0_10px_40px_-10px_rgba(12,35,64,0.18)] px-8 py-7 text-center">
        <CompassLogo className="w-11 h-11 mx-auto mb-3" />
        <h1 className="text-2xl font-bold text-navy mb-1">Payer Compass</h1>
        <p className="text-sm text-slate-600 mb-6">Sign in with your Bierman Microsoft account</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-left">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          onClick={handleEntraLogin}
          disabled={loading}
          className="w-full bg-navy hover:bg-navy-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
        >
          {loading ? 'Signing in...' : 'Sign in with Microsoft'}
        </button>
      </div>
    </main>
  )
}
