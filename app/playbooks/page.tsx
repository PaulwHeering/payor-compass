'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '../providers'
import InfoTip from '@/app/components/InfoTip'

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
  'w-full p-3 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-navy'

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
  // When the loaded instructions were last saved. Save and Delete only go ahead if they haven't changed
  // since, so a tip saved from the Review page (or someone else's edit) is never silently overwritten.
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Playbook | 'deleted' | null>(null)
  const [conflictOnDelete, setConflictOnDelete] = useState(false)
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

  const loadIntoForm = (found: Playbook | null | undefined) => {
    setExistingId(found?.id ?? null)
    setLoadedUpdatedAt(found?.updated_at ?? null)
    setConflict(null)
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

  // Choosing a field and scope loads whatever is already saved for that exact combination.
  const selectTarget = (nextFieldId: string, nextPayerId: string) => {
    setFieldId(nextFieldId)
    setPayerId(nextPayerId)
    setMessage(null)
    loadIntoForm(playbooks.find(p => p.field_id === nextFieldId && (p.payer_id ?? '') === nextPayerId))
  }

  // Reads what is saved right now for the chosen field and scope.
  const fetchLatest = async (): Promise<Playbook | null> => {
    let query = supabase
      .from('field_playbooks')
      .select(
        'id, field_id, payer_id, where_to_look, how_found, search_terms, authoritative_sources, gotchas, updated_by, updated_at, payers(name), field_definitions(label)'
      )
      .eq('field_id', fieldId)
    query = payerId ? query.eq('payer_id', payerId) : query.is('payer_id', null)
    const { data } = await query.maybeSingle()
    return (data as unknown as Playbook | null) ?? null
  }

  const showConflict = async (onDelete = false) => {
    const latest = await fetchLatest()
    setConflict(latest ?? 'deleted')
    setConflictOnDelete(onDelete)
    setBusy(false)
    setMessage({
      kind: 'error',
      text: `Not ${onDelete ? 'deleted' : 'saved'}: these instructions were changed since you opened them. Compare with the latest version below.`,
    })
  }

  const save = async (overwrite = false) => {
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

    // "Save mine anyway" writes over whatever is saved now; a normal save only updates the version that
    // was loaded into the form.
    let targetId = existingId
    let expectedUpdatedAt = loadedUpdatedAt
    if (overwrite) {
      const latest = await fetchLatest()
      targetId = latest?.id ?? null
      expectedUpdatedAt = latest?.updated_at ?? null
    }

    let saved: { id: string; updated_at: string } | null = null
    if (targetId) {
      let update = supabase.from('field_playbooks').update(row).eq('id', targetId)
      if (expectedUpdatedAt) update = update.eq('updated_at', expectedUpdatedAt)
      const { data, error } = await update.select('id, updated_at')
      if (error) {
        setBusy(false)
        setMessage({ kind: 'error', text: error.message })
        return
      }
      if (!data?.length) return await showConflict()
      saved = data[0] as { id: string; updated_at: string }
    } else {
      const { data, error } = await supabase
        .from('field_playbooks')
        .insert({ ...row, field_id: fieldId, payer_id: payerId || null })
        .select('id, updated_at')
        .single()
      // 23505 = someone else created instructions for this field and scope in the meantime.
      if (error?.code === '23505') return await showConflict()
      if (error) {
        setBusy(false)
        setMessage({ kind: 'error', text: error.message })
        return
      }
      saved = data as { id: string; updated_at: string }
    }

    setBusy(false)
    setExistingId(saved.id)
    setLoadedUpdatedAt(saved.updated_at)
    setConflict(null)
    setMessage({ kind: 'ok', text: 'Saved. Claude will use this the next time it researches this field.' })
    setRefreshKey(k => k + 1)
  }

  const remove = async () => {
    if (!existingId || !confirm('Delete these instructions?')) return
    setBusy(true)
    let del = supabase.from('field_playbooks').delete().eq('id', existingId)
    if (loadedUpdatedAt) del = del.eq('updated_at', loadedUpdatedAt)
    const { data, error } = await del.select('id')
    if (error) {
      setBusy(false)
      setMessage({ kind: 'error', text: error.message })
      return
    }
    if (!data?.length) return await showConflict(true)
    setBusy(false)
    loadIntoForm(null)
    setMessage({ kind: 'ok', text: 'Deleted.' })
    setRefreshKey(k => k + 1)
  }

  const set = (key: keyof typeof EMPTY_FORM) => (value: string) => setForm(f => ({ ...f, [key]: value }))

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50">
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold text-slate-900">Teach Claude where to look</h1>
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
                <InfoTip label="Field">
                  The piece of payer information these instructions are about, such as timely filing limit. Pick it
                  first; anything already saved for it loads below. Claude only researches fields set to
                  &ldquo;Internet&rdquo; on the Field Sources page, so instructions for other fields aren&apos;t used.
                </InfoTip>
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
                <InfoTip label="Applies to">
                  &ldquo;All payers&rdquo; means Claude uses these instructions whenever it researches this field.
                  &ldquo;Only [payer]&rdquo; means just for that payer. Each field can have one all-payers set plus
                  one set per payer. When Claude researches a payer, it reads both.
                </InfoTip>
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
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Where to look
                  <InfoTip label="Where to look">
                    The document, page or section Claude should check first. Be specific, e.g. &ldquo;Provider manual, Claims chapter&rdquo;. Claude starts its search here.
                  </InfoTip>
                </label>
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
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Sources to trust or avoid
                  <InfoTip label="Sources to trust or avoid">
                    Which websites or documents count as reliable for this field, and which to ignore, e.g. &ldquo;Only the payer&apos;s own site; ignore billing-company blogs.&rdquo;
                  </InfoTip>
                </label>
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
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Search terms that work
                  <InfoTip label="Search terms that work">
                    Words or phrases that find the answer when searching, separated by commas. Payers often use their own wording, e.g. &ldquo;claim submission deadline&rdquo; instead of &ldquo;timely filing&rdquo;.
                  </InfoTip>
                </label>
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
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Watch out for
                  <InfoTip label="Watch out for">
                    Mistakes to avoid and rules Claude must follow. Notes you save as playbook tips on the Review page are added here, one per line. Edit or delete lines that are out of date. Don&apos;t include member information.
                  </InfoTip>
                </label>
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
                  <InfoTip label="How it was found before">
                    A short description of where the answer was found last time, so Claude can go straight there and
                    check whether it changed.
                  </InfoTip>
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
                  <span className="inline-flex items-center">
                    <button
                      onClick={() => save()}
                      disabled={busy}
                      className="bg-navy hover:bg-navy-hover disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                    >
                      {busy ? 'Saving…' : 'Save instructions'}
                    </button>
                    <InfoTip label="Save instructions">
                      Saves everything above for the chosen field and payer scope. Claude uses it from the next research
                      run on. It doesn&apos;t change any published payer data.
                    </InfoTip>
                  </span>
                  {existingId && (
                    <span className="inline-flex items-center">
                      <button
                        onClick={remove}
                        disabled={busy}
                        className="border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 px-5 py-3 rounded-lg font-semibold transition-colors"
                      >
                        Delete
                      </button>
                      <InfoTip label="Delete">
                        Removes these instructions for this field and scope. Claude will then research it without them.
                        Published payer data isn&apos;t affected.
                      </InfoTip>
                    </span>
                  )}
                </div>
              )}
              {message && (
                <p className={`text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message.text}</p>
              )}
              {conflict && canEdit && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
                  {conflict === 'deleted' ? (
                    <p className="mb-3">Someone deleted these instructions after you opened them.</p>
                  ) : (
                    <>
                      <p className="mb-2">
                        Latest saved version
                        {conflict.updated_by ? ` (by ${conflict.updated_by}` : ' ('}
                        {new Date(conflict.updated_at).toLocaleString()}). Your text is still in the boxes above.
                      </p>
                      <dl className="mb-3 space-y-1">
                        {(
                          [
                            ['Where to look', conflict.where_to_look],
                            ['Sources to trust or avoid', conflict.authoritative_sources],
                            ['Search terms that work', (conflict.search_terms ?? []).join(', ')],
                            ['Watch out for', conflict.gotchas],
                            ['How it was found before', conflict.how_found],
                          ] as const
                        )
                          .filter(([, v]) => v)
                          .map(([k, v]) => (
                            <div key={k}>
                              <dt className="font-semibold">{k}</dt>
                              <dd className="whitespace-pre-wrap">{v}</dd>
                            </div>
                          ))}
                      </dl>
                    </>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => {
                        loadIntoForm(conflict === 'deleted' ? null : conflict)
                        setMessage(null)
                        setRefreshKey(k => k + 1)
                      }}
                      disabled={busy}
                      className="border border-amber-300 bg-white hover:bg-amber-100 disabled:opacity-50 px-4 py-2 rounded-lg font-semibold"
                    >
                      Load the latest version (drops my changes)
                    </button>
                    {!conflictOnDelete && (
                      <button
                        onClick={() => save(true)}
                        disabled={busy}
                        className="border border-amber-300 bg-white hover:bg-amber-100 disabled:opacity-50 px-4 py-2 rounded-lg font-semibold"
                      >
                        {conflict === 'deleted' ? 'Save mine as new' : 'Save mine anyway (replaces the latest)'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-slate-500">Choose a field to see or write its instructions.</p>
          )}
        </div>

        <h2 className="text-lg font-semibold text-slate-900 mb-3">
          Saved instructions
          <InfoTip label="Saved instructions">
            Every set of instructions saved so far, newest first, with who changed it last. Click Edit (or View) to
            load one into the form above.
          </InfoTip>
        </h2>
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
                    className="text-sm text-navy hover:text-navy-hover underline"
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
