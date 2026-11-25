'use client'

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/app/providers'
import CompassLogo from './CompassLogo'

// The left sidebar shown on every signed-in page. Cmd+B (Ctrl+B on Windows) opens and closes it; the choice is
// remembered in this browser. The person's name at the bottom opens a menu with Sign out.

const STORAGE_KEY = 'payor-compass.sidebar-open'

type Role = 'viewer' | 'manager' | 'admin'

const ICONS: Record<string, ReactNode> = {
  payors: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6" />
      <path d="M9 10h.01M15 10h.01" />
    </>
  ),
  research: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  review: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="m9 13 2 2 4-4" />
    </>
  ),
  playbooks: (
    <>
      <path d="M2 5h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" />
      <path d="M22 5h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0" />
      <path d="M16 4a4 4 0 0 1 0 8" />
      <path d="M18 14a7 7 0 0 1 4 7" />
    </>
  ),
  fieldSources: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
}

function Icon({ name, className = 'w-5 h-5' }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

interface NavItem {
  href: string
  label: string
  icon: string
  roles: Role[] // who sees it
  match: (path: string) => boolean
}

const NAV: NavItem[] = [
  {
    href: '/',
    label: 'Payors',
    icon: 'payors',
    roles: ['viewer', 'manager', 'admin'],
    match: p => p === '/' || p.startsWith('/payer'),
  },
  { href: '/research', label: 'Research', icon: 'research', roles: ['manager', 'admin'], match: p => p.startsWith('/research') },
  { href: '/review', label: 'Review Findings', icon: 'review', roles: ['manager', 'admin'], match: p => p.startsWith('/review') },
  { href: '/playbooks', label: 'Playbooks', icon: 'playbooks', roles: ['manager', 'admin'], match: p => p.startsWith('/playbooks') },
  { href: '/admin/users', label: 'Users', icon: 'users', roles: ['admin'], match: p => p.startsWith('/admin/users') },
  {
    href: '/admin/field-sources',
    label: 'Field Sources',
    icon: 'fieldSources',
    roles: ['admin'],
    match: p => p.startsWith('/admin/field-sources'),
  },
]

function displayName(meta: Record<string, unknown> | undefined, email: string | undefined) {
  const name = [meta?.full_name, meta?.name].find(v => typeof v === 'string' && v.trim()) as string | undefined
  return name?.trim() || email?.split('@')[0] || 'Signed in'
}

function initials(name: string) {
  const parts = name.replace(/[^\p{L}\s.]/gu, ' ').split(/[\s.]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

const SIDEBAR_CLASS =
  'sticky top-0 h-screen w-60 shrink-0 flex flex-col bg-gradient-to-b from-blue-50 via-white to-slate-50 border-r border-slate-200'

// Holds the open/closed state and Cmd+B. The sidebar itself reads the page address (usePathname), so it sits
// inside <Suspense>: Next.js pre-renders pages and only knows the address in the browser.
export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(true)

  // Remember open/closed per browser.
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'false') setOpen(false) // eslint-disable-line react-hooks/set-state-in-effect -- read once after mount
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setOpen(prev => {
          window.localStorage.setItem(STORAGE_KEY, String(!prev))
          return !prev
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // No sidebar until someone is signed in (the login page never has one).
  if (!user) return <>{children}</>

  const toggle = () =>
    setOpen(prev => {
      window.localStorage.setItem(STORAGE_KEY, String(!prev))
      return !prev
    })

  return (
    <div className="flex min-h-screen">
      {open ? (
        <Suspense fallback={<aside className={SIDEBAR_CLASS} />}>
          <Sidebar onClose={toggle} />
        </Suspense>
      ) : (
        <button
          onClick={toggle}
          title="Open sidebar (⌘B)"
          aria-label="Open sidebar"
          className="fixed top-3 left-3 z-40 p-2 rounded-lg bg-white border border-slate-200 shadow-sm text-slate-600 hover:text-slate-900"
        >
          <Icon name="panel" className="w-4 h-4" />
        </button>
      )}
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  )
}

function Sidebar({ onClose }: { onClose: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [role, setRole] = useState<Role | null>(null)
  const [pending, setPending] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) setRole((data?.role as Role) ?? 'viewer')
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // Pending findings count for the Review badge; refreshed when you move between pages.
  useEffect(() => {
    if (role !== 'manager' && role !== 'admin') return
    let cancelled = false
    supabase
      .from('findings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => {
        if (!cancelled) setPending(count ?? 0)
      })
    return () => {
      cancelled = true
    }
  }, [role, pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  if (!user) return null
  const name = displayName(user.user_metadata, user.email)
  const items = NAV.filter(item => role && item.roles.includes(role))

  return (
        <aside className={SIDEBAR_CLASS}>
          <div className="flex items-center justify-between px-4 py-4">
            <Link href="/" className="flex items-center gap-2.5">
              <CompassLogo className="w-8 h-8" />
              <span className="font-bold text-slate-900">Payor Compass</span>
            </Link>
            <button
              onClick={onClose}
              title="Close sidebar (⌘B)"
              aria-label="Close sidebar"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            >
              <Icon name="panel" className="w-4 h-4" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {items.map(item => {
              const active = item.match(pathname)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'
                  }`}
                >
                  <Icon name={item.icon} />
                  <span className="flex-1">{item.label}</span>
                  {item.href === '/review' && pending > 0 && (
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        active ? 'bg-white text-blue-700' : 'bg-blue-600 text-white'
                      }`}
                    >
                      {pending}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          <div ref={menuRef} className="relative border-t border-slate-200 p-3">
            {menuOpen && (
              <div className="absolute bottom-full left-3 right-3 mb-2 bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-200">
                  <p className="text-sm font-medium text-slate-900 truncate">{user.email}</p>
                  {role && <p className="text-xs text-slate-500 mt-0.5">Role: {role}</p>}
                </div>
                <button
                  onClick={async () => {
                    await signOut()
                    router.push('/auth/login')
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  Sign out
                </button>
              </div>
            )}
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-100 text-left"
              aria-expanded={menuOpen}
            >
              <span className="w-8 h-8 shrink-0 rounded-full bg-[#0C2340] text-white text-xs font-bold flex items-center justify-center">
                {initials(name)}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900 truncate">{name}</span>
                <span className="block text-xs text-slate-500 truncate">{user.email}</span>
              </span>
            </button>
          </div>
        </aside>
  )
}
