'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/app/providers'
import { FIELD_SOURCES, FIELD_SOURCE_INFO, type FieldSource } from '@/lib/research/scope'

interface Section {
  key: string
  label: string
}
interface Field {
  id: string
  section_key: string
  label: string
  source_mode: string
}

const OPTION_LABEL: Record<FieldSource, string> = {
  internet: 'Internet',
  medicaid: 'Web if Medicaid, files if commercial',
  file: 'Uploaded Files',
  hold: 'On hold',
}

export default function FieldSourcesPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)
  const [sections, setSections] = useState<Section[]>([])
  const [fields, setFields] = useState<Field[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const load = async () => {
      const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
      if (profile?.role !== 'admin') {
        router.push('/')
        return
      }
      const [sectionRes, fieldRes] = await Promise.all([
        supabase.from('sections').select('key, label').order('position'),
        supabase.from('field_definitions').select('id, section_key, label, source_mode').order('position'),
      ])
      if (cancelled) return
      setSections(sectionRes.data ?? [])
      setFields(fieldRes.data ?? [])
      setIsAdmin(true)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [user, router])

  const change = async (field: Field, mode: FieldSource) => {
    if (mode === field.source_mode) return
    setError(null)
    setSavingId(field.id)
    // Database rules only let admins change this one column; zero rows back means it was refused.
    const { data, error: updateError } = await supabase
      .from('field_definitions')
      .update({ source_mode: mode })
      .eq('id', field.id)
      .select('id')
    setSavingId(null)
    if (updateError || !data?.length) {
      setError(`Could not change "${field.label}": ${updateError?.message ?? 'not allowed.'}`)
      return
    }
    setFields(prev => prev.map(f => (f.id === field.id ? { ...f, source_mode: mode } : f)))
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50 flex items-center justify-center">
        <p className="text-slate-600">{loading ? 'Loading...' : 'You do not have permission to access this page.'}</p>
      </main>
    )
  }

  const counts = FIELD_SOURCES.map(mode => ({ mode, count: fields.filter(f => f.source_mode === mode).length }))

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50">
      <div className="max-w-4xl mx-auto p-8">
        <Link href="/" className="text-blue-600 hover:text-blue-700 text-sm font-semibold">
          ← Back to Payor Compass
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mt-2 mb-1">Field sources</h1>
        <p className="text-slate-600 mb-4">
          Choose how each field gets its value. Only fields set to <strong>Internet</strong> are searched on the web.
          Fields set to <strong>Uploaded Files</strong> are filled from contracts or other files uploaded on each payer&apos;s page;
          Claude can research them, but only in those files. Changes save
          immediately and apply to the next research run.
        </p>
        <div className="flex flex-wrap gap-2 mb-6">
          {counts.map(({ mode, count }) => (
            <span key={mode} className={`px-3 py-1 text-xs font-semibold rounded-lg ${FIELD_SOURCE_INFO[mode].className}`}>
              {OPTION_LABEL[mode]}: {count}
            </span>
          ))}
        </div>

        {error && <p className="mb-6 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">{error}</p>}

        <div className="space-y-6">
          {sections.map(section => {
            const sectionFields = fields.filter(f => f.section_key === section.key)
            if (sectionFields.length === 0) return null
            return (
              <div key={section.key} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <h2 className="px-6 py-3 bg-slate-50 border-b border-slate-200 font-semibold text-slate-900">
                  {section.label}
                </h2>
                <table className="w-full">
                  <thead>
                    <tr className="text-xs font-semibold text-slate-500 border-b border-slate-100">
                      <th className="text-left px-6 py-2 font-semibold">Field</th>
                      <th className="px-4 py-2 w-32 text-center font-semibold">Uploaded Files</th>
                      <th className="px-4 py-2 w-32 text-center font-semibold">Internet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sectionFields.map(field => {
                      const other = field.source_mode === 'medicaid' || field.source_mode === 'hold' ? field.source_mode : null
                      return (
                        <tr key={field.id}>
                          <td className="px-6 py-3 text-slate-800">
                            {field.label}
                            {other && (
                              <span className={`ml-2 px-2 py-0.5 text-[11px] font-semibold rounded-md ${FIELD_SOURCE_INFO[other].className}`}>
                                {FIELD_SOURCE_INFO[other].label}
                              </span>
                            )}
                          </td>
                          {(['file', 'internet'] as const).map(mode => (
                            <td key={mode} className="px-4 py-3 text-center">
                              <input
                                type="radio"
                                name={`source-${field.id}`}
                                aria-label={`${field.label}: ${mode === 'file' ? 'Uploaded Files' : 'Internet'}`}
                                checked={field.source_mode === mode}
                                disabled={savingId === field.id}
                                onChange={() => change(field, mode)}
                                className="h-4 w-4 cursor-pointer accent-blue-600"
                              />
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
