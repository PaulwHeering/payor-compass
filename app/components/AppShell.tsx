'use client'

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  BookOpen,
  Building2,
  ClipboardCheck,
  LogOut,
  PanelLeft,
  Search,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/app/providers'
import CompassLogo from './CompassLogo'

// The dark left sidebar shown on every signed-in page (same look as Sidelines). Cmd+B (Ctrl+B on Windows)
// opens and closes it; the choice is remembered in this browser. The person's name at the bottom opens a
// menu with Sign out.

const STORAGE_KEY = 'payor-compass.sidebar-open'

type Role = 'viewer' | 'manager' | 'admin'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  roles: Role[] // who sees it
  match: (path: string) => boolean
}

const NAV: NavItem[] = [
  {
    href: '/',
    label: 'Payors',
    icon: Building2,
    roles: ['viewer', 'manager', 'admin'],
    match: p => p === '/' || p.startsWith('/payer'),
  },
  { href: '/research', label: 'Research', icon: Search, roles: ['manager', 'admin'], match: p => p.startsWith('/research') },
  { href: '/review', label: 'Review Findings', icon: ClipboardCheck, roles: ['manager', 'admin'], match: p => p.startsWith('/review') },
  { href: '/playbooks', label: 'Playbooks', icon: BookOpen, roles: ['manager', 'admin'], match: p => p.startsWith('/playbooks') },
  { href: '/admin/users', label: 'Users', icon: Users, roles: ['admin'], match: p => p.startsWith('/admin/users') },
  {
    href: '/admin/field-sources',
    label: 'Field Sources',
    icon: SlidersHorizontal,
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

const SIDEBAR_CLASS = 'sticky top-0 h-screen w-60 shrink-0 flex flex-col bg-[#1f2b45] text-slate-200'

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
          className="fixed top-3 left-3 z-40 p-2 rounded-lg bg-[#1f2b45] text-slate-200 shadow-md hover:bg-[#2a3753]"
        >
          <PanelLeft className="w-4 h-4" />
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
      <div className="flex items-start justify-between gap-2 px-4 py-4 border-b border-white/10">
        <Link href="/" className="flex items-center gap-3 min-w-0">
          <CompassLogo className="w-9 h-9 shrink-0 rounded-full ring-1 ring-white/25" />
          <span className="min-w-0">
            <span className="block font-bold text-white leading-tight">Payor Compass</span>
            <span className="block text-xs text-slate-400 leading-tight mt-0.5">Payer Profiles &amp; Research</span>
          </span>
        </Link>
        <button
          onClick={onClose}
          title="Close sidebar (⌘B)"
          aria-label="Close sidebar"
          className="p-1 mt-0.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {items.map(item => {
          const active = item.match(pathname)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 px-4 py-2 text-sm border-l-[3px] transition-colors ${
                active
                  ? 'border-blue-300 bg-white/10 text-white font-semibold'
                  : 'border-transparent text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
              <span className="flex-1">{item.label}</span>
              {item.href === '/review' && pending > 0 && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-300 text-[#1f2b45]">{pending}</span>
              )}
            </Link>
          )
        })}
      </nav>

      <div ref={menuRef} className="relative border-t border-white/10 p-3">
        {menuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden text-slate-900">
            <div className="px-3 py-2 border-b border-slate-200">
              <p className="text-sm font-medium truncate">{user.email}</p>
              {role && <p className="text-xs text-slate-500 mt-0.5">Role: {role}</p>}
            </div>
            <button
              onClick={async () => {
                await signOut()
                router.push('/auth/login')
              }}
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen(o => !o)}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/10 text-left"
          aria-expanded={menuOpen}
        >
          <span className="w-8 h-8 shrink-0 rounded-full bg-[#0C2340] ring-1 ring-white/25 text-white text-xs font-bold flex items-center justify-center">
            {initials(name)}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-white truncate">{name}</span>
            <span className="block text-xs text-slate-400 truncate">{user.email}</span>
          </span>
        </button>
      </div>
    </aside>
  )
}
