'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '../providers'
import InfoTip from '@/app/components/InfoTip'
import { isResearchable } from '@/lib/research/scope'

const MAX_FIELDS = 25
const CONCURRENCY = 2

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
  source_mode: string
  section_key: string
  label: string
  position: number
}
interface Task {
  id: string
  run_id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  summary: string | null
  error: string | null
  created_at: string
  payers: { name: string } | null
  field_definitions: { label: string } | null
  research_runs: { requested_by: string; created_at: string } | null
}

const STATUS_STYLE: Record<Task['status'], string> = {
  queued: 'bg-slate-100 text-slate-700',
  running: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

const STATUS_LABEL: Record<Task['status'], string> = {
  queued: 'Waiting',
  running: 'Researching…',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
}

export default function ResearchPage() {
  const { user } = useAuth()
  const email = user?.email ?? ''

  const [role, setRole] = useState<string | null>(null)
  const [payers, setPayers] = useState<Payer[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [fields, setFields] = useState<Field[]>([])
  const [payerId, setPayerId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [starting, setStarting] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const inFlight = useRef(new Set<string>())

  const canRun = role === 'manager' || role === 'admin'

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
      const [payerRes, sectionRes, fieldRes] = await Promise.all([
        supabase.from('payers').select('id, name').order('name'),
        supabase.from('sections').select('key, label, position').order('position'),
        supabase.from('field_definitions').select('id, source_mode, section_key, label, position').order('position'),
      ])
      if (cancelled) return
      setPayers(payerRes.data ?? [])
      // Only fields marked "research on internet" are offered; the rest are filled from files.
      const researchable = ((fieldRes.data ?? []) as Field[]).filter(f => isResearchable(f.source_mode))
      setFields(researchable)
      const withFields = new Set(researchable.map(f => f.section_key))
      setSections((sectionRes.data ?? []).filter(s => withFields.has(s.key)))
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Keeps the task list fresh and works through this user's queued tasks while the page is open.
  useEffect(() => {
    if (!email || !canRun) return
    let cancelled = false

    const runOne = async (taskId: string) => {
      inFlight.current.add(taskId)
      try {
        const response = await fetch('/api/research/run-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: taskId }),
        })
        if (!response.ok && !cancelled) {
          const body = await response.json().catch(() => null)
          setMessage({ kind: 'error', text: body?.error ?? `The research request failed (HTTP ${response.status}).` })
        }
      } catch {
        // The task stays "running" and is picked up again if it goes stale.
      } finally {
        inFlight.current.delete(taskId)
      }
    }

    const refresh = async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('research_tasks')
        .select(
          'id, run_id, status, summary, error, created_at, payers(name), field_definitions(label), research_runs(requested_by, created_at)'
        )
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200)
      if (cancelled || !data) return
      const rows = data as unknown as Task[]
      setTasks(rows)

      const mine = rows
        .filter(t => t.status === 'queued' && t.research_runs?.requested_by === email && !inFlight.current.has(t.id))
        .reverse()
      for (const task of mine) {
        if (inFlight.current.size >= CONCURRENCY) break
        void runOne(task.id)
      }
    }

    refresh()
    const timer = setInterval(refresh, 4000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [email, canRun, refreshKey])

  const toggleField = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleSection = (sectionKey: string) => {
    const ids = fields.filter(f => f.section_key === sectionKey).map(f => f.id)
    const allSelected = ids.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      ids.forEach(id => (allSelected ? next.delete(id) : next.add(id)))
      return next
    })
  }

  const start = async () => {
    setMessage(null)
    setStarting(true)
    try {
      const response = await fetch('/api/research/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payer_id: payerId, field_ids: [...selected] }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ kind: 'error', text: body?.error ?? 'Could not start research.' })
        return
      }
      setSelected(new Set())
      if (body?.skipped) {
        setMessage({ kind: 'info', text: `${body.skipped} field(s) were skipped because they are already being researched.` })
      }
      setRefreshKey(k => k + 1)
    } finally {
      setStarting(false)
    }
  }

  const stopRun = async (runId: string) => {
    await supabase.from('research_tasks').update({ status: 'cancelled' }).eq('run_id', runId).eq('status', 'queued')
    setRefreshKey(k => k + 1)
  }

  const retryTask = async (taskId: string) => {
    await supabase
      .from('research_tasks')
      .update({ status: 'queued', attempts: 0, error: null, finished_at: null })
      .eq('id', taskId)
      .eq('status', 'failed')
    setRefreshKey(k => k + 1)
  }

  const runs = Object.values(
    tasks.reduce<Record<string, Task[]>>((acc, task) => {
      ;(acc[task.run_id] ||= []).push(task)
      return acc
    }, {})
  )

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50">
      <div className="max-w-4xl mx-auto p-8">
        <Link href="/" className="text-blue-600 hover:text-blue-700 text-sm font-semibold">
          ← Back to payers
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">Research with Claude</h1>
        <p className="text-slate-600 mb-6">
          Pick a payer and the fields to research. Claude searches the web, finds each answer with its source, and the
          server checks every quote against the real document. Results go to{' '}
          <Link href="/review" className="text-blue-600 underline">
            Review findings
          </Link>
          . Nothing goes live until you approve it.{' '}
          <Link href="/playbooks" className="text-blue-600 underline">
            Teach Claude where to look
          </Link>{' '}
          for any field.
        </p>
        <p className="text-sm text-slate-500 -mt-4 mb-6">
          Only fields that can be found on the internet are listed. Fields marked &ldquo;From uploaded files&rdquo; are
          filled from files the team provides.
        </p>

        {role && !canRun && (
          <p className="mb-6 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg p-3">
            Only managers and admins can start research.
          </p>
        )}

        {message && (
          <p
            className={`mb-6 text-sm rounded-lg p-3 border ${
              message.kind === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-blue-50 border-blue-200 text-blue-700'
            }`}
          >
            {message.text}
          </p>
        )}

        {canRun && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-8">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">New research</h2>

            <label className="block text-sm font-semibold text-slate-700 mb-1" htmlFor="payer">
              Payer
              <InfoTip label="Payer">
                The insurance payer to research. Claude looks up the chosen fields for this payer only. To research
                several payers, start one at a time.
              </InfoTip>
            </label>
            <select
              id="payer"
              value={payerId}
              onChange={e => setPayerId(e.target.value)}
              className="w-full max-w-sm p-2 border border-slate-300 rounded-lg text-slate-900 mb-6"
            >
              <option value="">Choose a payer…</option>
              {payers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <p className="text-sm font-semibold text-slate-700 mb-2">
              Fields
              <InfoTip label="Fields">
                Tick the pieces of information you want Claude to find. The box next to a section name ticks or
                clears every field in it. Only fields set to &ldquo;Internet&rdquo; on the Field Sources page appear
                here. Claude also checks fields that already have a value and proposes a change if the source now
                says something different. Up to {MAX_FIELDS} fields at a time.
              </InfoTip>
            </p>
            <div className="space-y-4 mb-6">
              {sections.map(section => {
                const sectionFields = fields.filter(f => f.section_key === section.key)
                const count = sectionFields.filter(f => selected.has(f.id)).length
                return (
                  <div key={section.key} className="border border-slate-200 rounded-lg p-4">
                    <label className="flex items-center gap-2 font-semibold text-slate-900 mb-2">
                      <input
                        type="checkbox"
                        checked={sectionFields.length > 0 && count === sectionFields.length}
                        onChange={() => toggleSection(section.key)}
                      />
                      {section.label}
                      <span className="text-xs font-normal text-slate-500">
                        {count}/{sectionFields.length} selected
                      </span>
                    </label>
                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 pl-6">
                      {sectionFields.map(field => (
                        <label key={field.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={selected.has(field.id)} onChange={() => toggleField(field.id)} />
                          {field.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={start}
                disabled={starting || !payerId || selected.size === 0 || selected.size > MAX_FIELDS}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                {starting ? 'Starting…' : `Research ${selected.size} field${selected.size === 1 ? '' : 's'}`}
              </button>
              <InfoTip label="Research fields">
                Starts research for the chosen payer and fields. Claude works on {CONCURRENCY} fields at a time
                and the progress appears under Recent research below. Keep this page open until they finish.
                Results go to Review findings; nothing is published until a reviewer approves it.
              </InfoTip>
              <p className="text-sm text-slate-500">
                {selected.size > MAX_FIELDS
                  ? `Choose at most ${MAX_FIELDS} fields at a time.`
                  : 'Each field takes a minute or two and uses Claude API credits. Keep this page open while it runs.'}
              </p>
            </div>
          </div>
        )}

        <h2 className="text-lg font-semibold text-slate-900 mb-3">
          Recent research (last 24 hours)
          <InfoTip label="Recent research">
            Each box is one research request, with the status of each field. Waiting: in line to start.
            Researching: Claude is working on it now. Done: finished, and the result is on the Review page (the note
            next to it says what was found). Failed: something went wrong; the reason is shown and you can retry.
            Stopped: cancelled before it started.
          </InfoTip>
        </h2>
        {runs.length === 0 ? (
          <p className="text-slate-500">No research yet.</p>
        ) : (
          <div className="space-y-4">
            {runs.map(group => {
              const first = group[0]
              const hasQueued = group.some(t => t.status === 'queued')
              const hasDone = group.some(t => t.status === 'done')
              return (
                <div key={first.run_id} className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                  <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                    <div>
                      <p className="font-semibold text-slate-900">{first.payers?.name ?? 'Unknown payer'}</p>
                      <p className="text-xs text-slate-500">
                        Started {first.research_runs ? new Date(first.research_runs.created_at).toLocaleString() : ''} by{' '}
                        {first.research_runs?.requested_by}
                      </p>
                    </div>
                    <div className="flex gap-3 text-sm">
                      {hasDone && (
                        <span className="inline-flex items-center">
                          <Link href="/review" className="text-blue-600 hover:text-blue-700 font-semibold">
                            Review findings →
                          </Link>
                          <InfoTip label="Review findings" align="right">
                            Opens the Review page, where you check each value Claude found against its source and
                            approve, reject or ask for more info.
                          </InfoTip>
                        </span>
                      )}
                      {hasQueued && canRun && (
                        <span className="inline-flex items-center">
                          <button onClick={() => stopRun(first.run_id)} className="text-slate-600 hover:text-slate-900 underline">
                            Stop waiting fields
                          </button>
                          <InfoTip label="Stop waiting fields" align="right">
                            Cancels the fields that haven&apos;t started yet (marked Waiting). Fields Claude is already
                            researching finish normally, and finished results are kept.
                          </InfoTip>
                        </span>
                      )}
                    </div>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {group.map(task => (
                      <li key={task.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-slate-800">{task.field_definitions?.label ?? 'Unknown field'}</span>
                        <span className="flex items-center gap-3">
                          {(task.summary || task.error) && (
                            <span className={`text-sm ${task.status === 'failed' ? 'text-red-600' : 'text-slate-500'}`}>
                              {task.status === 'failed' ? task.error : task.summary}
                            </span>
                          )}
                          {task.status === 'failed' && canRun && (
                            <span className="inline-flex items-center">
                              <button onClick={() => retryTask(task.id)} className="text-sm text-blue-600 underline">
                                Retry
                              </button>
                              <InfoTip label="Retry" align="right">
                                Puts this field back in line to be researched again. Keep this page open so it runs.
                              </InfoTip>
                            </span>
                          )}
                          <span className={`px-3 py-1 text-xs font-bold rounded-lg ${STATUS_STYLE[task.status]}`}>
                            {STATUS_LABEL[task.status]}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
