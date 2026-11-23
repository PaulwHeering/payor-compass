'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '../providers'

interface Finding {
  id: string
  payer_id: string
  field_id: string
  proposed_value: string | null
  source_url: string | null
  source_quote: string | null
  source_type: string | null
  confidence: 'high' | 'medium' | 'low'
  status: 'pending' | 'approved' | 'rejected' | 'needs_info' | 'not_found' | 'superseded'
  replaces_value_id: string | null
  reviewer_email: string | null
  reviewed_at: string | null
  reviewer_notes: string | null
  agent_note: string | null
  quote_verified: boolean | null
  verification_note: string | null
  created_at: string
  retrieved_at: string
  payers: { name: string } | null
  field_definitions: { label: string; section_key: string } | null
  replaced: { value: string } | null
}

type StatusTab = Finding['status']

const TABS: { key: StatusTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'needs_info', label: 'Needs info' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'not_found', label: 'Not found' },
]

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-red-100 text-red-700',
}

// Source URLs come from web research, so only ever link to plain http(s) addresses.
function safeUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

function FindingCard({
  finding,
  sectionLabel,
  canReview,
  reviewerEmail,
  onChanged,
}: {
  finding: Finding
  sectionLabel: string
  canReview: boolean
  reviewerEmail: string
  onChanged: () => void
}) {
  const [value, setValue] = useState(finding.proposed_value ?? '')
  const [note, setNote] = useState('')
  const [saveTip, setSaveTip] = useState(false)
  const [tipScope, setTipScope] = useState<'payer' | 'all'>('payer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const link = safeUrl(finding.source_url)
  const isPending = finding.status === 'pending'
  const edited = value.trim() !== (finding.proposed_value ?? '')

  const fail = (message: string) => {
    setError(message)
    setBusy(false)
  }

  // Adds the note to the field's playbook ("Watch out for"), so every future research run sees it,
  // not just the most recent ones. Only runs when the reviewer ticks the box.
  const saveNoteAsTip = async (): Promise<boolean> => {
    if (!saveTip) return true
    const tip = note.trim().replace(/\s*\n\s*/g, ' ')
    const payerId = tipScope === 'payer' ? finding.payer_id : null
    let query = supabase.from('field_playbooks').select('id, gotchas').eq('field_id', finding.field_id)
    query = payerId ? query.eq('payer_id', payerId) : query.is('payer_id', null)
    const { data, error: readError } = await query.maybeSingle()
    const existing = data as { id: string; gotchas: string | null } | null
    if (readError) {
      fail(`Could not save the playbook tip: ${readError.message}`)
      return false
    }
    const line = `- ${tip}`
    const stamp = { updated_by: reviewerEmail || null, updated_at: new Date().toISOString() }
    const result = existing
      ? existing.gotchas?.split('\n').some(l => l.trim() === line)
        ? { error: null }
        : await supabase
            .from('field_playbooks')
            .update({ gotchas: existing.gotchas?.trim() ? `${existing.gotchas.trim()}\n${line}` : line, ...stamp })
            .eq('id', existing.id)
      : await supabase
          .from('field_playbooks')
          .insert({ field_id: finding.field_id, payer_id: payerId, gotchas: line, ...stamp })
    if (result.error) {
      fail(`Could not save the playbook tip: ${result.error.message}`)
      return false
    }
    return true
  }

  const approve = async () => {
    if (!value.trim()) return fail('The value cannot be empty.')
    if (saveTip && !note.trim()) return fail('Write a note to save it as a playbook tip.')
    setBusy(true)
    setError(null)
    if (!(await saveNoteAsTip())) return

    if (edited) {
      const { data, error: updateError } = await supabase
        .from('findings')
        .update({ proposed_value: value.trim() })
        .eq('id', finding.id)
        .eq('status', 'pending')
        .select('id')
      if (updateError || !data?.length) {
        return fail(updateError?.message || 'This finding is no longer pending. Refresh the page.')
      }
    }

    const notes =
      [note.trim(), edited ? `Value edited by reviewer. Original proposal: ${finding.proposed_value}` : '']
        .filter(Boolean)
        .join('\n') || null

    const { error: rpcError } = await supabase.rpc('publish_finding', {
      p_finding_id: finding.id,
      p_notes: notes,
    })
    if (rpcError) return fail(rpcError.message)
    onChanged()
  }

  const setStatus = async (status: 'rejected' | 'needs_info') => {
    if (!note.trim()) {
      return fail(
        status === 'rejected'
          ? 'Please give a reason. It teaches Claude what to avoid.'
          : 'Please say what information is needed.'
      )
    }
    setBusy(true)
    setError(null)
    if (!(await saveNoteAsTip())) return
    const { data, error: updateError } = await supabase
      .from('findings')
      .update({
        status,
        reviewer_email: reviewerEmail,
        reviewed_at: new Date().toISOString(),
        reviewer_notes: note.trim(),
      })
      .eq('id', finding.id)
      .eq('status', 'pending')
      .select('id')
    if (updateError || !data?.length) {
      return fail(updateError?.message || 'This finding is no longer pending. Refresh the page.')
    }
    onChanged()
  }

  const reopen = async () => {
    setBusy(true)
    setError(null)
    const { data, error: updateError } = await supabase
      .from('findings')
      .update({ status: 'pending' })
      .eq('id', finding.id)
      .eq('status', 'needs_info')
      .select('id')
    if (updateError || !data?.length) {
      return fail(updateError?.message || 'Could not reopen this finding.')
    }
    onChanged()
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
        <div>
          <p className="text-sm text-slate-500">
            {finding.payers?.name ?? 'Unknown payer'} · {sectionLabel}
          </p>
          <h2 className="text-lg font-semibold text-slate-900">
            {finding.field_definitions?.label ?? 'Unknown field'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {finding.status !== 'not_found' && (
            <span
              className={`px-3 py-1 text-xs font-bold rounded-lg ${CONFIDENCE_STYLE[finding.confidence] ?? ''}`}
            >
              {finding.confidence} confidence
            </span>
          )}
          {finding.replaces_value_id && (
            <span className="px-3 py-1 text-xs font-bold rounded-lg bg-blue-100 text-blue-700">
              Changes a live value
            </span>
          )}
        </div>
      </div>

      {finding.status === 'not_found' ? (
        <p className="text-slate-700">Claude could not find this value.</p>
      ) : (
        <>
          {finding.replaced && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Current live value</p>
              <p className="text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap">
                {finding.replaced.value}
              </p>
            </div>
          )}

          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">
            {isPending && canReview ? 'Value to publish (you can edit it)' : 'Proposed value'}
          </p>
          {isPending && canReview ? (
            <textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              rows={3}
              className="w-full p-3 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1"
            />
          ) : (
            <p className="text-slate-900 whitespace-pre-wrap mb-1">{finding.proposed_value}</p>
          )}
          {edited && isPending && <p className="text-xs text-orange-600 mb-3">Edited from Claude&apos;s proposal.</p>}

          <p className="text-xs font-semibold text-slate-500 uppercase mt-4 mb-1">Source quote</p>
          <blockquote className="border-l-4 border-slate-300 pl-4 text-slate-700 italic mb-2 whitespace-pre-wrap">
            {finding.source_quote}
          </blockquote>
          <p className="text-sm mb-1">
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 underline break-all"
              >
                Open source document
              </a>
            ) : (
              <span className="text-red-600">Source link is missing or not a web address.</span>
            )}
            {finding.source_type && (
              <span className="text-slate-500"> · {finding.source_type.replace('_', ' ')}</span>
            )}
            <span className="text-slate-500">
              {' '}
              · retrieved {new Date(finding.retrieved_at).toLocaleDateString()}
            </span>
          </p>
          {finding.quote_verified === true && (
            <p className="text-sm text-green-700 mb-1">
              ✓ The server found this quote in the downloaded document.
              {finding.verification_note && ` ${finding.verification_note}`}
            </p>
          )}
          {finding.quote_verified === false && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-1">
              Not verified automatically. {finding.verification_note}
            </p>
          )}
          <p className="text-xs text-slate-500 mb-4">
            {finding.quote_verified === true
              ? 'The quote is real. Still check that it applies to the right plan, state and year.'
              : 'Check that the quote is really in the document and that it applies to the right plan, state and year.'}
          </p>
        </>
      )}

      {finding.agent_note && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-800 uppercase mb-1">Claude&apos;s note</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{finding.agent_note}</p>
        </div>
      )}

      {!isPending && finding.reviewer_email && (
        <p className="text-sm text-slate-600 mb-2">
          {finding.status === 'approved' ? 'Approved' : finding.status === 'rejected' ? 'Rejected' : 'Marked'} by{' '}
          {finding.reviewer_email}
          {finding.reviewed_at && ` on ${new Date(finding.reviewed_at).toLocaleDateString()}`}
          {finding.reviewer_notes && `: ${finding.reviewer_notes}`}
        </p>
      )}

      {canReview && isPending && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (required to reject or ask for more info)"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
          />
          <div className="mb-3 text-sm text-slate-700">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={saveTip}
                onChange={e => setSaveTip(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Also save this note as a playbook tip, so Claude always follows it for this field
            </label>
            {saveTip && (
              <div className="mt-2 ml-6 flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`tip-scope-${finding.id}`}
                    checked={tipScope === 'payer'}
                    onChange={() => setTipScope('payer')}
                  />
                  For {finding.payers?.name ?? 'this payer'} only
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`tip-scope-${finding.id}`}
                    checked={tipScope === 'all'}
                    onChange={() => setTipScope('all')}
                  />
                  For all payers
                </label>
                <p className="w-full text-xs text-slate-500">
                  It is added under &ldquo;Watch out for&rdquo; on the{' '}
                  <Link href="/playbooks" className="text-blue-600 hover:text-blue-700 underline">
                    Playbooks
                  </Link>{' '}
                  page, where you can edit or remove it. Don&apos;t include member information.
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={approve}
              disabled={busy || finding.status === 'not_found'}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-semibold transition-colors"
            >
              Approve and publish
            </button>
            <button
              onClick={() => setStatus('rejected')}
              disabled={busy}
              className="border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 px-5 py-2 rounded-lg font-semibold transition-colors"
            >
              Reject
            </button>
            <button
              onClick={() => setStatus('needs_info')}
              disabled={busy}
              className="border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 px-5 py-2 rounded-lg font-semibold transition-colors"
            >
              Needs more info
            </button>
          </div>
        </div>
      )}

      {canReview && finding.status === 'needs_info' && (
        <button
          onClick={reopen}
          disabled={busy}
          className="mt-2 border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 px-5 py-2 rounded-lg font-semibold transition-colors"
        >
          Reopen as pending
        </button>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  )
}

export default function ReviewPage() {
  const { user } = useAuth()
  const [findings, setFindings] = useState<Finding[]>([])
  const [sections, setSections] = useState<Record<string, string>>({})
  const [role, setRole] = useState<string | null>(null)
  const [tab, setTab] = useState<StatusTab>('pending')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [refreshKey, setRefreshKey] = useState(0)
  const reload = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const [findingsRes, sectionsRes] = await Promise.all([
        supabase
          .from('findings')
          .select(
            '*, payers(name), field_definitions(label, section_key), replaced:payer_values!findings_replaces_value_id_fkey(value)'
          )
          .order('created_at', { ascending: true })
          .limit(500),
        supabase.from('sections').select('key, label'),
      ])
      if (cancelled) return
      if (findingsRes.error) {
        setLoadError(findingsRes.error.message)
      } else {
        setLoadError(null)
        setFindings((findingsRes.data as unknown as Finding[]) ?? [])
      }
      setSections(Object.fromEntries((sectionsRes.data ?? []).map(s => [s.key, s.label])))
      setLoading(false)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  useEffect(() => {
    if (!user) return
    supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setRole(data?.role ?? null))
  }, [user])

  const canReview = role === 'manager' || role === 'admin'
  const counts = (status: StatusTab) => findings.filter(f => f.status === status).length
  const visible = findings.filter(f => f.status === tab)

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50">
      <div className="max-w-4xl mx-auto p-8">
        <div className="mb-8">
          <Link href="/" className="text-blue-600 hover:text-blue-700 text-sm font-semibold">
            ← Back to payers
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mt-2">Review research findings</h1>
          <p className="text-slate-600">
            Claude proposes values with a source and quote. Nothing goes live until you approve it.{' '}
            {(role === 'manager' || role === 'admin') && (
              <Link href="/research" className="text-blue-600 hover:text-blue-700 underline">
                Start new research
              </Link>
            )}
          </p>
          {role && !canReview && (
            <p className="mt-3 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg p-3">
              You can read findings, but only managers and admins can approve or reject them.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === t.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {t.label} ({counts(t.key)})
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-slate-400 py-12">Loading...</p>
        ) : loadError ? (
          <p className="text-red-600">Could not load findings: {loadError}</p>
        ) : visible.length === 0 ? (
          <div className="bg-white border border-slate-200 p-12 rounded-xl text-center shadow-sm">
            <p className="text-slate-600">No {TABS.find(t => t.key === tab)?.label.toLowerCase()} findings.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {visible.map(f => (
              <FindingCard
                key={f.id}
                finding={f}
                sectionLabel={sections[f.field_definitions?.section_key ?? ''] ?? ''}
                canReview={canReview}
                reviewerEmail={user?.email ?? ''}
                onChanged={reload}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
