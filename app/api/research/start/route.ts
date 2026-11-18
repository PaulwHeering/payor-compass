import { NextRequest, NextResponse } from 'next/server'
import { requireReviewer } from '@/lib/supabase-server'
import { researchConfigured } from '@/lib/research/engine'

const MAX_FIELDS_PER_RUN = 25
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Creates a research run with one queued task per field. The tasks are executed one at a time by
// POST /api/research/run-task, so each gets its own time limit.
export async function POST(request: NextRequest) {
  const auth = await requireReviewer()
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  if (!researchConfigured()) {
    return NextResponse.json(
      { error: 'Research is not set up yet: the Claude API key is missing on the server.' },
      { status: 503 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const payerId = (body as { payer_id?: unknown })?.payer_id
  const rawFieldIds = (body as { field_ids?: unknown })?.field_ids
  if (typeof payerId !== 'string' || !UUID.test(payerId) || !Array.isArray(rawFieldIds)) {
    return NextResponse.json({ error: 'Choose a payer and at least one field.' }, { status: 400 })
  }
  const fieldIds = [...new Set(rawFieldIds.filter((id): id is string => typeof id === 'string' && UUID.test(id)))]
  if (fieldIds.length === 0) return NextResponse.json({ error: 'Choose at least one field.' }, { status: 400 })
  if (fieldIds.length > MAX_FIELDS_PER_RUN) {
    return NextResponse.json({ error: `Choose at most ${MAX_FIELDS_PER_RUN} fields at a time.` }, { status: 400 })
  }

  const { supabase, email } = auth

  const [payerRes, fieldsRes, activeRes] = await Promise.all([
    supabase.from('payers').select('id, name').eq('id', payerId).single(),
    supabase.from('field_definitions').select('id').in('id', fieldIds),
    supabase
      .from('research_tasks')
      .select('field_id')
      .eq('payer_id', payerId)
      .in('field_id', fieldIds)
      .in('status', ['queued', 'running']),
  ])
  if (!payerRes.data) return NextResponse.json({ error: 'That payer does not exist.' }, { status: 404 })
  if ((fieldsRes.data ?? []).length !== fieldIds.length) {
    return NextResponse.json({ error: 'One or more fields do not exist.' }, { status: 400 })
  }

  // Don't spend twice on a field that is already queued or running for this payer.
  const active = new Set((activeRes.data ?? []).map(t => t.field_id as string))
  const toRun = fieldIds.filter(id => !active.has(id))
  if (toRun.length === 0) {
    return NextResponse.json({ error: 'Those fields are already being researched for this payer.' }, { status: 409 })
  }

  const { data: run, error: runError } = await supabase
    .from('research_runs')
    .insert({
      payer_id: payerId,
      kind: 'research',
      requested_by: email,
      notes: `Web app research: ${toRun.length} field${toRun.length === 1 ? '' : 's'}`,
    })
    .select('id')
    .single()
  if (runError || !run) {
    return NextResponse.json({ error: `Could not start research: ${runError?.message}` }, { status: 500 })
  }

  const { data: tasks, error: taskError } = await supabase
    .from('research_tasks')
    .insert(toRun.map(fieldId => ({ run_id: run.id, payer_id: payerId, field_id: fieldId })))
    .select('id')
  if (taskError || !tasks) {
    return NextResponse.json({ error: `Could not queue the fields: ${taskError?.message}` }, { status: 500 })
  }

  return NextResponse.json({
    run_id: run.id,
    task_ids: tasks.map(t => t.id),
    skipped: fieldIds.length - toRun.length,
  })
}
