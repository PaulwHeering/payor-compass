'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '../providers'

interface Payer {
  id: string
  name: string
}
interface Section {
  key: string
  label: string
  position: number
}
interface Field {
  id: string
  section_key: string
  label: string
  position: number
}
interface Playbook {
  id: string
  field_id: string
  payer_id: string | null
  where_to_look: string | null
  how_found: string | null
  search_terms: string[] | null
  authoritative_sources: string | null
  gotchas: string | null
  updated_by: string | null
  updated_at: string
  payers: { name: string } | null
  field_definitions: { label: string } | null
}

const EMPTY_FORM = { where_to_look: '', authoritative_sources: '', search_terms: '', gotchas: '', how_found: '' }

const inputClass =
  'w-full p-3 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function PlaybooksPage() {
  const { user } = useAuth()
  const [role, setRole] = useState<string | null>(null)
  const [payers, setPayers] = useState<Payer[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [fields, setFields] = useState<Field[]>([])
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [fieldId, setFieldId] = useState('')
  const [payerId, setPayerId] = useState('') // '' = applies to all payers
  const [existingId, setExistingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const canEdit = role === 'manager' || role === 'admin'

  useEffect(() => {
    if (!user) return
    supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setRole(data?.role ?? null))
  }, [user])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [payerRes, sectionRes, fieldRes, playbookRes] = await Promise.all([
        supabase.from('payers').select('id, name').order('name'),
        supabase.from('sections').select('key, label, position').order('position'),
        supabase.from('field_definitions').select('id, section_key, label, position').order('position'),
        supabase
          .from('field_playbooks')
          .select(
            'id, field_id, payer_id, where_to_look, how_found, search_terms, authoritative_sources, gotchas, updated_by, updated_at, payers(name), field_definitions(label)'
          )
          .order('updated_at', { ascending: false }),
      ])
      if (cancelled) return
      setPayers(payerRes.data ?? [])
      setSections(sectionRes.data ?? [])
      setFields(fieldRes.data ?? [])
      setPlaybooks((playbookRes.data as unknown as Playbook[]) ?? [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  // Choosing a field and scope loads whatever is already saved for that exact combination.
  const selectTarget = (nextFieldId: string, nextPayerId: string) => {
    setFieldId(nextFieldId)
    setPayerId(nextPayerId)
    setMessage(null)
    const found = playbooks.find(p => p.field_id === nextFieldId && (p.payer_id ?? '') === nextPayerId)
    setExistingId(found?.id ?? null)
    setForm(
      found
        ? {
            where_to_look: found.where_to_look ?? '',
            authoritative_sources: found.authoritative_sources ?? '',
            search_terms: (found.search_terms ?? []).join(', '),
            gotchas: found.gotchas ?? '',
            how_found: found.how_found ?? '',
          }
        : EMPTY_FORM
    )
  }

  const save = async () => {
    if (!fieldId) return
    const terms = form.search_terms
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
    const row = {
      where_to_look: form.where_to_look.trim() || null,
      authoritative_sources: form.authoritative_sources.trim() || null,
      search_terms: terms.length ? terms : null,
      gotchas: form.gotchas.trim() || null,
      how_found: form.how_found.trim() || null,
      updated_by: user?.email ?? null,
      updated_at: new Date().toISOString(),
    }
    if (!row.where_to_look && !row.authoritative_sources && !row.search_terms && !row.gotchas && !row.how_found) {
      setMessage({ kind: 'error', text: 'Write at least one instruction before saving.' })
      return
    }
    setBusy(true)
    setMessage(null)
    const result = existingId
      ? await supabase.from('field_playbooks').update(row).eq('id', existingId)
      : await supabase
          .from('field_playbooks')
          .insert({ ...row, field_id: fieldId, payer_id: payerId || null })
          .select('id')
          .single()
    setBusy(false)
    if (result.error) {
      setMessage({ kind: 'error', text: result.error.message })
      return
    }
    if (!existingId && result.data && 'id' in result.data) setExistingId(result.data.id as string)
    setMessage({ kind: 'ok', text: 'Saved. Claude will use this the next time it researches this field.' })
    setRefreshKey(k => k + 1)
  }

  const remove = async () => {
    if (!existingId || !confirm('Delete these instructions?')) return
    setBusy(true)
    const { error } = await supabase.from('field_playbooks').delete().eq('id', existingId)
    setBusy(false)
    if (error) {
      setMessage({ kind: 'error', text: error.message })
      return
    }
    setExistingId(null)
    setForm(EMPTY_FORM)
    setMessage({ kind: 'ok', text: 'Deleted.' })
    setRefreshKey(k => k + 1)
  }

  const set = (key: keyof typeof EMPTY_FORM) => (value: string) => setForm(f => ({ ...f, [key]: value }))

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50">
      <div className="max-w-4xl mx-auto p-8">
        <Link href="/research" className="text-blue-600 hover:text-blue-700 text-sm font-semibold">
          ← Back to research
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">Teach Claude where to look</h1>
        <p className="text-slate-600 mb-6">
          Write instructions for a field, like &ldquo;check the provider manual, Claims section&rdquo;. Claude reads them
          every time it researches that field. Apply them to all payers, or to just one.
        </p>

        {role && !canEdit && (
          <p className="mb-6 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg p-3">
            You can read instructions here, but only managers and admins can change them.
          </p>
        )}

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-8">
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1" htmlFor="field">
                Field
              </label>
              <select
                id="field"
                value={fieldId}
                onChange={e => selectTarget(e.target.value, payerId)}
                className="w-full p-2 border border-slate-300 rounded-lg text-slate-900"
              >
                <option value="">Choose a field…</option>
                {sections.map(section => (
                  <optgroup key={section.key} label={section.label}>
                    {fields
                      .filter(f => f.section_key === section.key)
                      .map(f => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1" htmlFor="scope">
                Applies to
              </label>
              <select
                id="scope"
                value={payerId}
                onChange={e => selectTarget(fieldId, e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-lg text-slate-900"
              >
                <option value="">All payers</option>
                {payers.map(p => (
                  <option key={p.id} value={p.id}>
                    Only {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {fieldId ? (
            <div className="space-y-4">
              {existingId && <p className="text-sm text-slate-500">Editing saved instructions.</p>}

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Where to look</label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={form.where_to_look}
                  onChange={e => set('where_to_look')(e.target.value)}
                  disabled={!canEdit}
                  placeholder="e.g. Check the provider manual, Claims section, before looking anywhere else."
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Sources to trust or avoid</label>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={form.authoritative_sources}
                  onChange={e => set('authoritative_sources')(e.target.value)}
                  disabled={!canEdit}
                  placeholder="e.g. Trust the payer's own documents. Ignore billing company blogs."
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Search terms that work</label>
                <input
                  type="text"
                  maxLength={500}
                  value={form.search_terms}
                  onChange={e => set('search_terms')(e.target.value)}
                  disabled={!canEdit}
                  placeholder="Separate with commas, e.g. timely filing, claim submission deadline"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Watch out for</label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={form.gotchas}
                  onChange={e => set('gotchas')(e.target.value)}
                  disabled={!canEdit}
                  placeholder="e.g. The Medicaid plan has different rules. Only use the commercial documents."
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  How it was found before (optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={form.how_found}
                  onChange={e => set('how_found')(e.target.value)}
                  disabled={!canEdit}
                  placeholder="e.g. Found in the state supplement, New York section, under Claims practices."
                  className={inputClass}
                />
              </div>

              {canEdit && (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={save}
                    disabled={busy}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                  >
                    {busy ? 'Saving…' : 'Save instructions'}
                  </button>
                  {existingId && (
                    <button
                      onClick={remove}
                      disabled={busy}
                      className="border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 px-5 py-3 rounded-lg font-semibold transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
              {message && (
                <p className={`text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message.text}</p>
              )}
            </div>
          ) : (
            <p className="text-slate-500">Choose a field to see or write its instructions.</p>
          )}
        </div>

        <h2 className="text-lg font-semibold text-slate-900 mb-3">Saved instructions</h2>
        {playbooks.length === 0 ? (
          <p className="text-slate-500">
            None yet. As findings are approved, Claude also remembers where they were found, even without instructions.
          </p>
        ) : (
          <ul className="space-y-3">
            {playbooks.map(p => (
              <li key={p.id} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <div className="flex flex-wrap justify-between items-start gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{p.field_definitions?.label ?? 'Unknown field'}</p>
                    <p className="text-xs text-slate-500">
                      {p.payers ? `Only ${p.payers.name}` : 'All payers'} · updated{' '}
                      {new Date(p.updated_at).toLocaleDateString()}
                      {p.updated_by ? ` by ${p.updated_by}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      selectTarget(p.field_id, p.payer_id ?? '')
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                    className="text-sm text-blue-600 hover:text-blue-700 underline"
                  >
                    {canEdit ? 'Edit' : 'View'}
                  </button>
                </div>
                {p.where_to_look && <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{p.where_to_look}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
