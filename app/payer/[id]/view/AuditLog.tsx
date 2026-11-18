'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface AuditEntry {
  id: string
  payer_id: string
  field_id: string | null
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
  change_type: string
}

interface Field {
  id: string
  label: string
}

export default function AuditLog({ payerId }: { payerId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [fields, setFields] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    loadAuditLog()
  }, [payerId])

  const loadAuditLog = async () => {
    setLoading(true)
    try {
      // Load field definitions for labels
      const { data: fieldData } = await supabase
        .from('field_definitions')
        .select('id, label')

      const fieldMap = new Map<string, string>()
      fieldData?.forEach(f => fieldMap.set(f.id, f.label))
      setFields(fieldMap)

      // Load audit log entries
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .eq('payer_id', payerId)
        .order('changed_at', { ascending: false })

      if (error) throw error
      setEntries(data || [])
    } catch (err) {
      console.error('Error loading audit log:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-slate-500">Loading history...</div>
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <p>No change history yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-6 text-left hover:bg-slate-50 transition-colors flex items-center justify-between"
      >
        <h2 className="text-lg font-bold text-slate-900">Change History</h2>
        <span className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-slate-200">
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {entries.map(entry => (
              <div key={entry.id} className="pb-4 border-b border-slate-100 last:border-0">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {entry.field_id ? fields.get(entry.field_id) || 'Unknown Field' : 'Payer Name'}
                  </p>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">
                    {entry.change_type}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  {new Date(entry.changed_at).toLocaleString()} by {entry.changed_by}
                </p>
                <div className="bg-slate-50 rounded p-3 space-y-2">
                  {entry.old_value && (
                    <div>
                      <p className="text-xs font-semibold text-slate-600 mb-1">Before:</p>
                      <p className="text-sm text-slate-700 break-words">
                        {entry.old_value}
                      </p>
                    </div>
                  )}
                  {entry.new_value && (
                    <div>
                      <p className="text-xs font-semibold text-slate-600 mb-1">After:</p>
                      <p className="text-sm text-slate-700 break-words">
                        {entry.new_value}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
