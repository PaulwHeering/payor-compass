'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '../providers'
import InfoTip from '@/app/components/InfoTip'

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
          {finding.status !== 'not_found' && (
            <InfoTip label="Confidence" align="right">
              How sure Claude is that the value is right. High means the source states it plainly. Medium or
              low means Claude had to interpret the wording or the source may be out of date, so check those
              more carefully.
            </InfoTip>
          )}
          {finding.replaces_value_id && (
            <span className="px-3 py-1 text-xs font-bold rounded-lg bg-blue-100 text-blue-700">
              Changes a live value
            </span>
          )}
          {finding.replaces_value_id && (
            <InfoTip label="Changes a live value" align="right">
              This payer already has a published value for this field, and Claude found something different.
              Approving replaces the current live value (shown below) with this one.
            </InfoTip>
          )}
        </div>
      </div>

      {finding.status === 'not_found' ? (
        <p className="text-slate-700">Claude could not find this value.</p>
      ) : (
        <>
          {finding.replaced && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">
                Current live value
                <InfoTip label="Current live value">
                  What the app shows for this payer today. If you approve, it is replaced by the value below.
                </InfoTip>
              </p>
              <p className="text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap">
                {finding.replaced.value}
              </p>
            </div>
          )}

          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">
            {isPending && canReview ? 'Value to publish (you can edit it)' : 'Proposed value'}
            <InfoTip label={isPending && canReview ? 'Value to publish' : 'Proposed value'}>
              {isPending && canReview
                ? 'The value Claude found. This is exactly what goes live when you click Approve and publish. If it is nearly right, fix the wording here before approving; Claude sees your correction in future research.'
                : 'The value Claude proposed for this field.'}
            </InfoTip>
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

          <p className="text-xs font-semibold text-slate-500 uppercase mt-4 mb-1">
            Source quote
            <InfoTip label="Source quote">
              The exact words Claude copied from the source document to back up the value. Read it and check it
              really says what the value says, for the right plan, state and year.
            </InfoTip>
          </p>
          <blockquote className="border-l-4 border-slate-300 pl-4 text-slate-700 italic mb-2 whitespace-pre-wrap">
            {finding.source_quote}
          </blockquote>
          <p className="text-sm mb-1">
            {link ? (
              <>
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 underline break-all"
                >
                  Open source document
                </a>
                <InfoTip label="Open source document">
                  Opens the page or PDF the quote came from in a new tab. Use it to check the quote in context, for
                  example that it isn&apos;t from an old manual or a different state&apos;s plan.
                </InfoTip>
              </>
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
          <p className="text-xs font-semibold text-amber-800 uppercase mb-1">
            Claude&apos;s note
            <InfoTip label="Claude's note">
              Something Claude wants you to know, such as doubts about the source or other values it saw. Read it
              before deciding.
            </InfoTip>
          </p>
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
          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">
            Note
            <InfoTip label="Note">
              Tell Claude what was right or wrong. Required when you reject or ask for more info; optional when
              you approve. Your note is saved with this finding, and Claude reads the most recent notes for this
              field the next time it researches it. Example: &ldquo;This is the commercial plan; we need the
              Medicaid plan.&rdquo;
            </InfoTip>
          </p>
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
            <InfoTip label="Save as a playbook tip">
              Normal notes are only used while they are among the 10 most recent for this field. Tick this to
              also save the note as a lasting instruction in the field&apos;s playbook, so Claude follows it in
              every future run. Use it for lessons that will stay true, like &ldquo;Always use the provider
              manual, not the member handbook.&rdquo; It is saved when you click one of the buttons below.
            </InfoTip>
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
                <InfoTip label="For this payer only">
                  The tip is used only when Claude researches this field for {finding.payers?.name ?? 'this payer'}.
                  Pick this for lessons about one payer&apos;s website or documents.
                </InfoTip>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`tip-scope-${finding.id}`}
                    checked={tipScope === 'all'}
                    onChange={() => setTipScope('all')}
                  />
                  For all payers
                </label>
                <InfoTip label="For all payers">
                  The tip is used whenever Claude researches this field, for every payer. Pick this for lessons
                  about the field itself, such as what counts as the right answer.
                </InfoTip>
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
            <span className="inline-flex items-center">
              <button
                onClick={approve}
                disabled={busy || finding.status === 'not_found'}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-semibold transition-colors"
              >
                Approve and publish
              </button>
              <InfoTip label="Approve and publish">
                Makes the value above live in the app straight away (replacing any current value) and records you
                as the approver. Only approve when the quote supports the value. The finding moves to the Approved
                tab.
              </InfoTip>
            </span>
            <span className="inline-flex items-center">
              <button
                onClick={() => setStatus('rejected')}
                disabled={busy}
                className="border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 px-5 py-2 rounded-lg font-semibold transition-colors"
              >
                Reject
              </button>
              <InfoTip label="Reject">
                The value is wrong or the source isn&apos;t good enough. Nothing is published. You must write a
                note saying why; Claude reads it next time so it avoids the same mistake. The finding moves to the
                Rejected tab.
              </InfoTip>
            </span>
            <span className="inline-flex items-center">
              <button
                onClick={() => setStatus('needs_info')}
                disabled={busy}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 px-5 py-2 rounded-lg font-semibold transition-colors"
              >
                Needs more info
              </button>
              <InfoTip label="Needs more info">
                Use this when you can&apos;t decide yet, for example the value may be right but you need to check
                with someone or the answer is incomplete. Nothing is published. Write what is missing in the note.
                The finding moves to the Needs info tab, where you can reopen it later.
              </InfoTip>
            </span>
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
      {canReview && finding.status === 'needs_info' && (
        <InfoTip label="Reopen as pending">
          Moves this finding back to the Pending tab so you (or another reviewer) can approve or reject it.
        </InfoTip>
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
            {(role === 'manager' || role === 'admin') && (
              <>
                {' · '}
                <Link href="/playbooks" className="text-blue-600 hover:text-blue-700 underline">
                  Playbooks
                </Link>
              </>
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
          <InfoTip label="Tabs">
            Pending: waiting for your decision. Needs info: put on hold to look into. Approved: published to the
            app. Rejected: turned down, with the reason. Not found: Claude searched and couldn&apos;t find the
            value; nothing to approve. The number is how many findings are in each tab.
          </InfoTip>
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
