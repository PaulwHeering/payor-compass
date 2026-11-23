'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import SourceBadge from '@/app/components/SourceBadge'

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

export default function PayerForm() {
  const params = useParams()
  const router = useRouter()
  const payerId = params.id as string
  const isNew = payerId === 'new'

  const [payer, setPayer] = useState<Payer | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [fields, setFields] = useState<Field[]>([])
  const [values, setValues] = useState<Map<string, PayerValue[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [payerName, setPayerName] = useState('')
  const [activeSection, setActiveSection] = useState<string | null>(null)

  useEffect(() => {
    if (isNew) {
      loadMetadata()
    } else {
      loadPayer()
    }
  }, [payerId, isNew])

  const loadMetadata = async () => {
    setLoading(true)
    try {
      const [secRes, fieldRes] = await Promise.all([
        supabase.from('sections').select('*').order('position'),
        supabase.from('field_definitions').select('*').order('position'),
      ])

      if (secRes.error) throw secRes.error
      if (fieldRes.error) throw fieldRes.error

      setSections(secRes.data || [])
      setFields(fieldRes.data || [])
    } catch (err) {
      console.error('Error loading metadata:', err)
      alert('Failed to load form')
    } finally {
      setLoading(false)
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
      setPayerName(pRes.data.name)

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
      alert('Failed to load payer')
    } finally {
      setLoading(false)
    }
  }

  const updateFieldValue = (fieldId: string, index: number, newValue: string) => {
    const vals = values.get(fieldId) || []
    const newVals = [...vals]
    if (!newVals[index]) {
      newVals[index] = {
        id: `temp-${Date.now()}-${Math.random()}`,
        payer_id: payerId,
        field_id: fieldId,
        value: newValue,
        position: index,
      }
    } else {
      newVals[index].value = newValue
    }
    const newMap = new Map(values)
    newMap.set(fieldId, newVals)
    setValues(newMap)
  }

  const addFieldValue = (fieldId: string) => {
    const vals = values.get(fieldId) || []
    const newVals = [...vals]
    newVals.push({
      id: `temp-${Date.now()}-${Math.random()}`,
      payer_id: payerId,
      field_id: fieldId,
      value: '',
      position: newVals.length,
    })
    const newMap = new Map(values)
    newMap.set(fieldId, newVals)
    setValues(newMap)
  }

  const removeFieldValue = (fieldId: string, index: number) => {
    const vals = values.get(fieldId) || []
    const newVals = vals.filter((_, i) => i !== index)
    const newMap = new Map(values)
    if (newVals.length > 0) {
      newMap.set(fieldId, newVals)
    } else {
      newMap.delete(fieldId)
    }
    setValues(newMap)
  }

  const savePayer = async () => {
    if (!payerName.trim()) {
      alert('Payer name is required')
      return
    }

    setSaving(true)
    try {
      let currentPayerId = payerId
      const auditLogs: any[] = []
      const changedBy = 'paul.heering@biermanautism.com' // TODO: use actual user from auth

      // Create or update payer
      if (isNew) {
        const { data, error } = await supabase
          .from('payers')
          .insert({ name: payerName.trim() })
          .select()
          .single()

        if (error) throw error
        currentPayerId = data.id

        // Log payer creation
        auditLogs.push({
          payer_id: currentPayerId,
          old_value: null,
          new_value: payerName.trim(),
          changed_by: changedBy,
          change_type: 'create',
        })
      } else {
        // Log payer name change if it changed
        if (payer && payer.name !== payerName.trim()) {
          auditLogs.push({
            payer_id: payerId,
            old_value: payer.name,
            new_value: payerName.trim(),
            changed_by: changedBy,
            change_type: 'update',
          })
        }

        const { error } = await supabase
          .from('payers')
          .update({ name: payerName.trim() })
          .eq('id', payerId)

        if (error) throw error
      }

      // Track old values before deletion
      let oldValues: Map<string, string> = new Map()
      if (!isNew) {
        const { data: oldData } = await supabase
          .from('payer_values')
          .select('*')
          .eq('payer_id', currentPayerId)

        if (oldData) {
          oldData.forEach(v => {
            const key = `${v.field_id}:${v.position}`
            oldValues.set(key, v.value)
          })
        }

        // Delete existing values
        const { error } = await supabase
          .from('payer_values')
          .delete()
          .eq('payer_id', currentPayerId)
        if (error) throw error
      }

      // Insert new values and log changes
      const valuesToInsert: any[] = []
      values.forEach((vals, fieldId) => {
        vals.forEach((v, idx) => {
          if (v.value.trim()) {
            valuesToInsert.push({
              payer_id: currentPayerId,
              field_id: fieldId,
              value: v.value.trim(),
              position: idx,
            })

            // Log field value changes
            const oldKey = `${fieldId}:${idx}`
            const oldValue = oldValues.get(oldKey)
            if (oldValue !== v.value.trim()) {
              auditLogs.push({
                payer_id: currentPayerId,
                field_id: fieldId,
                old_value: oldValue || null,
                new_value: v.value.trim(),
                changed_by: changedBy,
                change_type: !isNew ? 'update' : 'create',
              })
            }
          }
        })
      })

      if (valuesToInsert.length > 0) {
        const { error } = await supabase.from('payer_values').insert(valuesToInsert)
        if (error) throw error
      }

      // Insert audit logs
      if (auditLogs.length > 0) {
        const { error } = await supabase.from('audit_log').insert(auditLogs)
        if (error) {
          console.error('Error inserting audit logs:', error)
          // Don't fail the save if audit logging fails
        }
      }

      router.push('/')
    } catch (err) {
      console.error('Error saving payer:', err)
      alert('Failed to save payer')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  if (!activeSection) {
    // Grid view: Show all sections as cards
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-7xl mx-auto p-8">
          {/* Header */}
          <div className="mb-12">
            <Link href="/" className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-6">
              ← Back to Payers
            </Link>
            <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
              <label className="block text-sm font-semibold text-slate-600 mb-3">Payer Name</label>
              <input
                type="text"
                value={payerName}
                onChange={e => setPayerName(e.target.value)}
                className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg font-semibold"
                placeholder="e.g. Blue Cross Blue Shield"
              />
            </div>

            <h1 className="text-4xl font-bold text-slate-900 mb-2">
              Payer Profile — Categories & Contents
            </h1>
            <p className="text-slate-600">
              {isNew ? 'Enter insurance information across 7 sections' : 'Update payer information'}
            </p>
          </div>

          {/* Section Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {sections.map(section => {
              const sectionFields = fields.filter(f => f.section_key === section.key)
              return (
                <button
                  key={section.key}
                  onClick={() => setActiveSection(section.key)}
                  className="bg-white rounded-lg shadow-sm hover:shadow-md transition-all p-6 text-left hover:border-blue-500 border-2 border-transparent group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-900 group-hover:text-blue-600">
                      {section.label}
                    </h2>
                    <span className="text-sm font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                      {sectionFields.length}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {sectionFields.slice(0, 5).map(field => (
                      <li key={field.id} className="text-sm text-slate-600 flex items-start gap-2">
                        <span className="text-blue-500 mt-1">•</span>
                        <span>{field.label}</span>
                      </li>
                    ))}
                    {sectionFields.length > 5 && (
                      <li className="text-sm text-slate-500 italic">
                        + {sectionFields.length - 5} more fields
                      </li>
                    )}
                  </ul>
                </button>
              )
            })}
          </div>

          {/* Save buttons */}
          <div className="flex gap-4 justify-center">
            <button
              onClick={savePayer}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              {saving ? 'Saving...' : 'Save All Changes'}
            </button>
            <Link
              href="/"
              className="px-8 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-semibold transition-colors"
            >
              Cancel
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // Detail view: Show selected section form
  const selectedSectionData = sections.find(s => s.key === activeSection)
  const sectionFields = fields.filter(f => f.section_key === activeSection)

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <button
          onClick={() => setActiveSection(null)}
          className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-6 font-semibold"
        >
          ← Back to Sections
        </button>

        <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            {selectedSectionData?.label}
          </h1>
          <p className="text-slate-600">
            {sectionFields.length} fields to complete
          </p>
        </div>

        {/* Form Fields */}
        <div className="bg-white rounded-lg shadow-sm p-8 space-y-8 mb-8">
          {sectionFields.map(field => {
            const fieldValues = values.get(field.id) || []

            return (
              <div key={field.id} className="pb-8 border-b border-slate-200 last:border-0">
                <label className="block text-sm font-semibold text-slate-900 mb-3">
                  {field.label}
                  <SourceBadge mode={field.source_mode} />
                  {field.help && (
                    <span className="block text-xs font-normal text-slate-500 mt-1">
                      {field.help}
                    </span>
                  )}
                </label>

                {field.repeatable ? (
                  <div className="space-y-3">
                    {fieldValues.length === 0 && (
                      <input
                        type={field.input_type === 'date' ? 'date' : 'text'}
                        value=""
                        onChange={e => updateFieldValue(field.id, 0, e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={`Enter ${field.label}`}
                      />
                    )}
                    {fieldValues.map((fv, idx) => (
                      <div key={fv.id} className="flex gap-3">
                        <input
                          type={field.input_type === 'date' ? 'date' : 'text'}
                          value={fv.value}
                          onChange={e => updateFieldValue(field.id, idx, e.target.value)}
                          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={`Enter ${field.label}`}
                        />
                        <button
                          onClick={() => removeFieldValue(field.id, idx)}
                          className="px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors font-medium"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addFieldValue(field.id)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-semibold mt-2"
                    >
                      + Add another {field.label}
                    </button>
                  </div>
                ) : (
                  <textarea
                    value={
                      fieldValues.length > 0 && fieldValues[0].value
                        ? fieldValues[0].value
                        : ''
                    }
                    onChange={e => updateFieldValue(field.id, 0, e.target.value)}
                    className={`w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      field.input_type === 'longtext' ? 'h-32' : 'h-10'
                    }`}
                    placeholder={`Enter ${field.label}`}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Action buttons */}
        <div className="flex gap-4">
          <button
            onClick={savePayer}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={() => setActiveSection(null)}
            className="px-8 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-semibold transition-colors"
          >
            Back to Sections
          </button>
          <Link
            href="/"
            className="px-8 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-semibold transition-colors"
          >
            Done
          </Link>
        </div>
      </div>
    </main>
  )
}
