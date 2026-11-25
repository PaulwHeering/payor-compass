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
// switches between the full sidebar and a narrow icon-only rail; the choice is remembered in this browser. The person's name at the bottom opens a
// menu with Sign out.

const STORAGE_KEY = 'payer-compass.sidebar-open'
const OLD_STORAGE_KEY = 'payor-compass.sidebar-open' // before the rename; still read so nobody loses their setting

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
    label: 'Payers',
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

const sidebarClass = (collapsed: boolean) =>
  `sticky top-0 z-30 h-screen ${collapsed ? 'w-16' : 'w-60'} shrink-0 flex flex-col bg-navy text-slate-200 transition-[width] duration-200`

// Holds the wide/narrow state and Cmd+B. The sidebar itself reads the page address (usePathname), so it sits
// inside <Suspense>: Next.js pre-renders pages and only knows the address in the browser.
export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(true)

  // Remember wide/narrow per browser.
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(OLD_STORAGE_KEY)
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
      <Suspense fallback={<aside className={sidebarClass(!open)} />}>
        <Sidebar collapsed={!open} onToggle={toggle} />
      </Suspense>
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  )
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
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
    <aside className={sidebarClass(collapsed)}>
      <div
        className={`flex gap-2 py-4 border-b border-white/10 ${
          collapsed ? 'flex-col items-center px-2' : 'items-start justify-between px-4'
        }`}
      >
        <Link href="/" title={collapsed ? 'Payer Compass' : undefined} className="flex items-center gap-3 min-w-0">
          <CompassLogo bare className="w-8 h-8 shrink-0" />
          {!collapsed && (
            <span className="min-w-0">
              <span className="block font-bold text-white leading-tight">Payer Compass</span>
              <span className="block text-xs text-slate-400 leading-tight mt-0.5">Payer Profiles &amp; Research</span>
            </span>
          )}
        </Link>
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={`relative flex items-center gap-3 py-2 text-sm border-l-[3px] transition-colors ${
                collapsed ? 'justify-center px-0' : 'px-4'
              } ${
                active
                  ? 'border-blue-300 bg-white/10 text-white font-semibold'
                  : 'border-transparent text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className={`${collapsed ? 'w-5 h-5' : 'w-4 h-4'} shrink-0`} strokeWidth={1.75} />
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {item.href === '/review' && pending > 0 && (
                <span
                  className={`font-bold rounded-full bg-blue-300 text-navy ${
                    collapsed ? 'absolute top-0.5 right-2.5 text-[9px] min-w-4 h-4 px-1 flex items-center justify-center' : 'text-[11px] px-2 py-0.5'
                  }`}
                >
                  {pending}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div ref={menuRef} className={`relative border-t border-white/10 ${collapsed ? 'p-2' : 'p-3'}`}>
        {menuOpen && (
          <div className="absolute bottom-full left-2 w-56 mb-2 z-50 bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden text-slate-900">
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
          className={`w-full flex items-center gap-3 py-2 rounded-lg hover:bg-white/10 text-left ${
            collapsed ? 'justify-center px-0' : 'px-2'
          }`}
          aria-expanded={menuOpen}
          title={collapsed ? name : undefined}
          aria-label={collapsed ? `${name}: account menu` : undefined}
        >
          <span className="w-8 h-8 shrink-0 rounded-full bg-navy-hover ring-1 ring-white/25 text-white text-xs font-bold flex items-center justify-center">
            {initials(name)}
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block text-sm font-medium text-white truncate">{name}</span>
              <span className="block text-xs text-slate-400 truncate">{user.email}</span>
            </span>
          )}
        </button>
      </div>
    </aside>
  )
}
