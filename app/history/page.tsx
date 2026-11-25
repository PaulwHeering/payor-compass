'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/app/providers'

// Every change recorded in the database (audit_log), newest first. The database writes these rows itself
// (see supabase/migrations/20261125000012_audit_triggers.sql), so this page only reads. Changes to people and
// job titles are returned to admins only.

interface Entry {
  id: string
  payer_id: string | null
  payer_name: string | null
  field_id: string | null
  table_name: string
  column_name: string | null
  item: string | null
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
  change_type: string
  note: string | null
}

const PAGE_SIZE = 100

const AREAS: { key: string; label: string; tables: string[]; adminOnly?: boolean }[] = [
  { key: 'payer', label: 'Payer data', tables: ['payers', 'payer_values'] },
  { key: 'files', label: 'Uploaded files', tables: ['payer_files'] },
  { key: 'research', label: 'Findings & playbooks', tables: ['findings', 'field_playbooks'] },
  { key: 'settings', label: 'Fields & sections', tables: ['field_definitions', 'sections'] },
  { key: 'users', label: 'Users & job titles', tables: ['user_profiles', 'job_titles'], adminOnly: true },
]
const AREA_OF = Object.fromEntries(AREAS.flatMap(a => a.tables.map(t => [t, a.label])))

const COLUMN_LABEL: Record<string, string> = {
  source_mode: 'Source',
  section_key: 'Section',
  input_type: 'Input type',
  job_title: 'Job title',
  file_name: 'File name',
  proposed_value: 'Proposed value',
  where_to_look: 'Where to look',
  how_found: 'How found',
  search_terms: 'Search terms',
  authoritative_sources: 'Sources to trust',
}
const columnLabel = (c: string) => COLUMN_LABEL[c] ?? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ')

const TYPE_STYLE: Record<string, string> = {
  create: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
}
const TYPE_LABEL: Record<string, string> = { create: 'Added', update: 'Changed', delete: 'Removed' }

// Characters that would break the PostgREST or() filter or act as wildcards.
const cleanSearch = (s: string) => s.replace(/[,()*%\\]/g, ' ').trim()

export default function HistoryPage() {
  return (
    <Suspense fallback={<Shell>Loading...</Shell>}>
      <History />
    </Suspense>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50 flex items-center justify-center">
      <p className="text-slate-600">{children}</p>
    </main>
  )
}

function History() {
  const params = useSearchParams()
  const { user } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)
  const [payers, setPayers] = useState<{ id: string; name: string }[]>([])
  const [fieldLabels, setFieldLabels] = useState<Map<string, string>>(new Map())

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [area, setArea] = useState('')
  const [payerId, setPayerId] = useState(params.get('payer') ?? '')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const [entries, setEntries] = useState<Entry[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())

  // Filter choices: payers that exist now (deleted ones are still found by searching their name).
  useEffect(() => {
    if (!user) return
    let cancelled = false
    Promise.all([
      supabase.from('user_profiles').select('role').eq('id', user.id).single(),
      supabase.from('payers').select('id, name').order('name'),
      supabase.from('field_definitions').select('id, label'),
    ]).then(([profile, payerRes, fieldRes]) => {
      if (cancelled) return
      setIsAdmin(profile.data?.role === 'admin')
      setPayers(payerRes.data ?? [])
      setFieldLabels(new Map((fieldRes.data ?? []).map(f => [f.id, f.label])))
    })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(cleanSearch(search)), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    let query = supabase
      .from('audit_log')
      .select('*', { count: 'exact' })
      .order('changed_at', { ascending: false })
      .range(0, limit - 1)
    const areaTables = AREAS.find(a => a.key === area)?.tables
    if (areaTables) query = query.in('table_name', areaTables)
    if (payerId) query = query.eq('payer_id', payerId)
    if (type) query = query.eq('change_type', type)
    if (from) query = query.gte('changed_at', new Date(`${from}T00:00:00`).toISOString())
    if (to) query = query.lt('changed_at', new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString())
    if (debounced) {
      const p = `%${debounced}%`
      query = query.or(
        ['payer_name', 'item', 'column_name', 'old_value', 'new_value', 'changed_by', 'note']
          .map(c => `${c}.ilike.${p}`)
          .join(','),
      )
    }
    query.then(({ data, count, error: err }) => {
      if (cancelled) return
      setError(err ? err.message : null)
      setEntries((data as Entry[]) ?? [])
      setTotal(count ?? null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [user, area, payerId, type, from, to, debounced, limit])

  const filtersOn = Boolean(search || area || payerId || type || from || to)
  const clear = () => {
    setSearch('')
    setArea('')
    setPayerId('')
    setType('')
    setFrom('')
    setTo('')
    setLimit(PAGE_SIZE)
  }
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setLimit(PAGE_SIZE)
  }

  const existingPayers = useMemo(() => new Set(payers.map(p => p.id)), [payers])
  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (!user) return <Shell>Loading...</Shell>

  const input = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy'

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50">
      <div className="max-w-7xl mx-auto p-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-1">History</h1>
        <p className="text-slate-600 mb-6">
          Every change made in Payer Compass, newest first: who made it, when, and the value before and after. The
          database records these itself, so nothing can be changed without showing up here, and the history can&apos;t
          be edited or deleted.
        </p>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
          <label className="flex-1 min-w-64">
            <span className="block text-xs font-semibold text-slate-600 mb-1">Search</span>
            <input
              type="search"
              value={search}
              onChange={e => resetPage(setSearch)(e.target.value)}
              placeholder="Payer, field, value, person..."
              className={`${input} w-full`}
            />
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600 mb-1">Payer</span>
            <select value={payerId} onChange={e => resetPage(setPayerId)(e.target.value)} className={`${input} max-w-56`}>
              <option value="">All payers</option>
              {payerId && !existingPayers.has(payerId) && <option value={payerId}>(deleted payer)</option>}
              {payers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600 mb-1">Area</span>
            <select value={area} onChange={e => resetPage(setArea)(e.target.value)} className={input}>
              <option value="">Everything</option>
              {AREAS.filter(a => isAdmin || !a.adminOnly).map(a => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600 mb-1">Change</span>
            <select value={type} onChange={e => resetPage(setType)(e.target.value)} className={input}>
              <option value="">Any</option>
              <option value="create">Added</option>
              <option value="update">Changed</option>
              <option value="delete">Removed</option>
            </select>
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600 mb-1">From</span>
            <input type="date" value={from} onChange={e => resetPage(setFrom)(e.target.value)} className={input} />
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600 mb-1">To</span>
            <input type="date" value={to} onChange={e => resetPage(setTo)(e.target.value)} className={input} />
          </label>
          {filtersOn && (
            <button onClick={clear} className="text-sm text-navy hover:text-navy-hover font-medium py-2">
              Clear filters
            </button>
          )}
        </div>

        <p className="text-sm text-slate-500 mb-2">
          {loading ? 'Loading...' : total === null ? '' : `${total.toLocaleString()} change${total === 1 ? '' : 's'}`}
          {!loading && total !== null && total > entries.length && ` · showing the newest ${entries.length}`}
        </p>
        {error && <p className="mb-4 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">{error}</p>}

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Payer</th>
                <th className="px-4 py-3">What</th>
                <th className="px-4 py-3">Change</th>
                <th className="px-4 py-3">Before</th>
                <th className="px-4 py-3">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    {filtersOn ? 'No changes match these filters.' : 'No changes recorded yet.'}
                  </td>
                </tr>
              )}
              {entries.map(e => {
                const expanded = open.has(e.id)
                const fieldLabel = e.field_id ? fieldLabels.get(e.field_id) : undefined
                // e.g. "Timely filing limit", "Field · Source: Timely filing limit", "Finding · Status: Timely filing limit"
                const what =
                  e.table_name === 'payer_values' || e.table_name === 'payers'
                    ? e.item
                    : [e.item, e.column_name && columnLabel(e.column_name)].filter(Boolean).join(' · ')
                // For settings, findings and playbooks: which field the change was about.
                const subject = e.table_name === 'payer_values' || e.table_name === 'payers' ? null : fieldLabel
                return (
                  <tr key={e.id} className="align-top hover:bg-slate-50/60">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {new Date(e.changed_at).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-700 break-all min-w-40">{e.changed_by}</td>
                    <td className="px-4 py-3 min-w-32">
                      {e.payer_id && existingPayers.has(e.payer_id) ? (
                        <Link href={`/payer/${e.payer_id}/view`} className="text-navy hover:text-navy-hover hover:underline">
                          {e.payer_name}
                        </Link>
                      ) : (
                        <span className="text-slate-700">
                          {e.payer_name ?? '—'}
                          {e.payer_id && e.payer_name && <span className="text-xs text-slate-400"> (deleted)</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 min-w-44">
                      <span className="font-medium text-slate-900">{what}</span>
                      {subject && <span className="block text-slate-600">{subject}</span>}
                      <span className="block text-xs text-slate-400">{AREA_OF[e.table_name] ?? e.table_name}</span>
                      {e.note && <span className="block text-xs text-slate-500 italic">{e.note}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${TYPE_STYLE[e.change_type] ?? 'bg-slate-100 text-slate-700'}`}
                      >
                        {TYPE_LABEL[e.change_type] ?? e.change_type}
                      </span>
                    </td>
                    <Value value={e.old_value} expanded={expanded} onToggle={() => toggle(e.id)} muted />
                    <Value value={e.new_value} expanded={expanded} onToggle={() => toggle(e.id)} />
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {total !== null && total > entries.length && (
          <div className="text-center mt-4">
            <button
              onClick={() => setLimit(l => l + PAGE_SIZE)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-navy"
            >
              Show {Math.min(PAGE_SIZE, total - entries.length)} more
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

// Long values are cut to two lines; clicking shows the whole before and after for that row.
function Value({
  value,
  expanded,
  onToggle,
  muted = false,
}: {
  value: string | null
  expanded: boolean
  onToggle: () => void
  muted?: boolean
}) {
  if (value === null || value === '') return <td className="px-4 py-3 text-slate-300">—</td>
  const long = value.length > 120
  return (
    <td className="px-4 py-3 min-w-48 max-w-md">
      <p
        className={`whitespace-pre-wrap break-words ${muted ? 'text-slate-500' : 'text-slate-900'} ${
          long && !expanded ? 'line-clamp-2' : ''
        }`}
      >
        {value}
      </p>
      {long && (
        <button onClick={onToggle} className="text-xs text-navy hover:text-navy-hover mt-1">
          {expanded ? 'Show less' : 'Show all'}
        </button>
      )}
    </td>
  )
}
