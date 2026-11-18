import { NextRequest, NextResponse } from 'next/server'
import { requireReviewer } from '@/lib/supabase-server'
import { runTask } from '@/lib/research/engine'

// One research task (one payer, one field) can take a few minutes: Claude searches the web,
// reads documents, and the server verifies the quote.
export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const auth = await requireReviewer()
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  let taskId: unknown
  try {
    taskId = ((await request.json()) as { task_id?: unknown })?.task_id
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (typeof taskId !== 'string' || !UUID.test(taskId)) {
    return NextResponse.json({ error: 'Invalid task.' }, { status: 400 })
  }

  const outcome = await runTask(auth.supabase, taskId)
  return NextResponse.json(outcome)
}
