'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AuditLog from './AuditLog'
import SourceBadge from '@/app/components/SourceBadge'
import InfoTip from '@/app/components/InfoTip'

interface Section {
  key: string
  label: string
  position: number
}

interface Field {
  id: string
  section_key: string
  key: string
  label: string
  input_type: string
  repeatable: boolean
  help?: string
  source_mode?: string
  position: number
}

interface PayerValue {
  id: string
  payer_id: string
  field_id: string
  value: string
  position: number
}

interface Payer {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export default function PayerViewer() {
  const params = useParams()
  const router = useRouter()
  const payerId = params.id as string

  const [payer, setPayer] = useState<Payer | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [fields, setFields] = useState<Field[]>([])
  const [values, setValues] = useState<Map<string, PayerValue[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadPayer()
  }, [payerId])

  const toggleSection = (sectionKey: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(sectionKey)) {
      newExpanded.delete(sectionKey)
    } else {
      newExpanded.add(sectionKey)
    }
    setExpandedSections(newExpanded)
  }

  const deletePayer = async () => {
    if (!confirm(`Delete "${payer?.name}"? This cannot be undone.`)) return
    try {
      const { error } = await supabase.from('payers').delete().eq('id', payerId)
      if (error) throw error
      router.push('/')
    } catch (err) {
      console.error('Error deleting payer:', err)
      alert('Failed to delete payer')
    }
  }

  const loadPayer = async () => {
    setLoading(true)
    try {
      // Load metadata
      const [secRes, fieldRes] = await Promise.all([
        supabase.from('sections').select('*').order('position'),
        supabase.from('field_definitions').select('*').order('position'),
      ])

      if (secRes.error) throw secRes.error
      if (fieldRes.error) throw fieldRes.error

      setSections(secRes.data || [])
      setFields(fieldRes.data || [])

      // Load payer
      const pRes = await supabase.from('payers').select('*').eq('id', payerId).single()
      if (pRes.error) throw pRes.error
      setPayer(pRes.data)

      // Load values
      const vRes = await supabase
        .from('payer_values')
        .select('*')
        .eq('payer_id', payerId)
        .order('field_id, position')

      if (vRes.error) throw vRes.error

      const valueMap = new Map<string, PayerValue[]>()
      vRes.data?.forEach(v => {
        const key = v.field_id
        if (!valueMap.has(key)) valueMap.set(key, [])
        valueMap.get(key)!.push(v)
      })
      setValues(valueMap)
    } catch (err) {
      console.error('Error loading payer:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="mb-12">
          <Link href="/" className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-6">
            ← Back to Payers
          </Link>

          <div className="bg-white rounded-lg shadow-sm p-8 mb-8 flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-2">Payer</p>
              <h1 className="text-4xl font-bold text-slate-900">
                {payer?.name}
              </h1>
              <p className="text-sm text-slate-500 mt-2">
                Updated {new Date(payer?.updated_at || '').toLocaleDateString()}
                <InfoTip label="Updated">The date this payer&apos;s record was last changed.</InfoTip>
              </p>
            </div>
            <span className="inline-flex items-center">
              <Link
                href={`/payer/${payerId}`}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                Edit Payer
              </Link>
              <InfoTip label="Edit Payer" align="right">
                Opens the form to change this payer&apos;s name and information directly. Changes go live as
                soon as you save (no review step) and are recorded in Change History. Only managers and admins can
                save changes.
              </InfoTip>
            </span>
          </div>

          <p className="text-slate-600 text-lg">
            Payer Profile — Categories & Contents
            <InfoTip label="Payer Profile">
              Everything recorded for this payer, grouped into sections. Click a section to open or close it. The
              grey number is how many fields the section has. &ldquo;Not provided&rdquo; means nobody has filled
              that field in yet. The coloured tag next to each field says how it gets its value: researched by
              Claude on the internet, or filled from files the team uploads.
            </InfoTip>
          </p>
        </div>

        {/* Audit Log */}
        <div className="mb-12">
          <AuditLog payerId={payerId} />
        </div>

        {/* Section Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {sections.map(section => {
            const sectionFields = fields.filter(f => f.section_key === section.key)
            const hasValues = sectionFields.some(f => values.has(f.id))

            const isExpanded = expandedSections.has(section.key)

            return (
              <div
                key={section.key}
                className="bg-white rounded-lg shadow-sm border-l-4 border-blue-600 overflow-hidden"
              >
                <button
                  onClick={() => toggleSection(section.key)}
                  className="w-full p-6 text-left hover:bg-slate-50 transition-colors flex items-start justify-between"
                >
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-slate-900">
                      {section.label}
                    </h2>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className="text-sm font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded whitespace-nowrap">
                      {sectionFields.length}
                    </span>
                    <span className={`text-slate-400 text-lg transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      ▼
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-6 pb-6 pt-0 space-y-4 border-t border-slate-100">
                    {sectionFields.map(field => {
                      const fieldValues = values.get(field.id) || []

                      if (fieldValues.length === 0) {
                        return (
                          <div key={field.id} className="pb-4 border-b border-slate-100 last:border-0">
                            <p className="text-sm font-semibold text-slate-700">
                              {field.label}
                              <SourceBadge mode={field.source_mode} />
                            </p>
                            <p className="text-sm text-slate-400 italic mt-1">Not provided</p>
                          </div>
                        )
                      }

                      return (
                        <div key={field.id} className="pb-4 border-b border-slate-100 last:border-0">
                          <p className="text-sm font-semibold text-slate-700 mb-2">
                            {field.label}
                            <SourceBadge mode={field.source_mode} />
                          </p>
                          {field.repeatable ? (
                            <ul className="space-y-1">
                              {fieldValues.map((fv, idx) => (
                                <li
                                  key={fv.id}
                                  className="text-sm text-slate-600 flex items-start gap-2"
                                >
                                  <span className="text-blue-500 mt-0.5">•</span>
                                  <span>{fv.value}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-slate-600 whitespace-pre-wrap">
                              {fieldValues[0].value}
                            </p>
                          )}
                        </div>
                      )
                    })}
                    {!hasValues && (
                      <p className="text-sm text-slate-400 italic text-center py-4">
                        No information entered
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer Action */}
        <div className="flex gap-4 justify-center">
          <span className="inline-flex items-center">
            <Link
              href={`/payer/${payerId}`}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              Edit This Payer
            </Link>
            <InfoTip label="Edit This Payer">
              Opens the form to change this payer&apos;s name and information directly. Changes go live as
                soon as you save (no review step) and are recorded in Change History. Only managers and admins can
                save changes.
            </InfoTip>
          </span>
          <span className="inline-flex items-center">
            <Link
              href="/"
              className="px-8 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-semibold transition-colors"
            >
              Back to List
            </Link>
            <InfoTip label="Back to List">Returns to the list of all payers.</InfoTip>
          </span>
          <span className="inline-flex items-center">
            <button
              onClick={deletePayer}
              className="px-8 py-3 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 font-semibold transition-colors"
            >
              Delete Payer
            </button>
            <InfoTip label="Delete Payer" align="right">
              Permanently removes this payer and everything recorded for it. You are asked to confirm first, and
              it can&apos;t be undone. Only managers and admins can delete.
            </InfoTip>
          </span>
        </div>
      </div>
    </main>
  )
}
