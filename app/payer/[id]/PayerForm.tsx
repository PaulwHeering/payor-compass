'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import SourceBadge from '@/app/components/SourceBadge'
import InfoTip from '@/app/components/InfoTip'
import PayerFiles from '@/app/components/PayerFiles'

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
      // The database records every change in the history (audit_log) itself, credited to whoever is signed
      // in. So this save changes only what actually changed: edited values are updated, cleared or removed
      // ones deleted, new ones added. Moving a list entry only updates its position.

      if (isNew) {
        const { data, error } = await supabase.from('payers').insert({ name: payerName.trim() }).select().single()
        if (error) throw error
        currentPayerId = data.id
      } else if (payer && payer.name !== payerName.trim()) {
        const { error } = await supabase.from('payers').update({ name: payerName.trim() }).eq('id', payerId)
        if (error) throw error
      }

      // Compare with what is saved now (not what was loaded), in case someone else changed it meanwhile.
      const saved = new Map<string, PayerValue>()
      if (!isNew) {
        const { data, error } = await supabase.from('payer_values').select('*').eq('payer_id', currentPayerId)
        if (error) throw error
        data?.forEach(v => saved.set(v.id, v))
      }

      const toInsert: { payer_id: string; field_id: string; value: string; position: number }[] = []
      const toUpdate: { id: string; changes: { value?: string; position?: number } }[] = []
      const keep = new Set<string>()
      values.forEach((vals, fieldId) => {
        let position = 0
        vals.forEach(v => {
          const value = v.value.trim()
          if (!value) return // cleared: deleted below if it was saved
          const existing = saved.get(v.id)
          if (existing) {
            keep.add(v.id)
            const changes: { value?: string; position?: number } = {}
            if (existing.value !== value) changes.value = value
            if (existing.position !== position) changes.position = position
            if (Object.keys(changes).length) toUpdate.push({ id: v.id, changes })
          } else {
            toInsert.push({ payer_id: currentPayerId, field_id: fieldId, value, position })
          }
          position++
        })
      })
      const toDelete = [...saved.keys()].filter(id => !keep.has(id))

      if (toDelete.length) {
        const { error } = await supabase.from('payer_values').delete().in('id', toDelete)
        if (error) throw error
      }
      for (const { id, changes } of toUpdate) {
        const { error } = await supabase
          .from('payer_values')
          .update({ ...changes, updated_at: new Date().toISOString() })
          .eq('id', id)
        if (error) throw error
      }
      if (toInsert.length) {
        const { error } = await supabase.from('payer_values').insert(toInsert)
        if (error) throw error
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
              <label className="block text-sm font-semibold text-slate-600 mb-3">
                Payer Name
                <InfoTip label="Payer Name">
                  The payer&apos;s main name as it should appear in the list. Put other names the payer goes by in
                  the &ldquo;Payer name(s) / AKAs&rdquo; field instead.
                </InfoTip>
              </label>
              <input
                type="text"
                value={payerName}
                onChange={e => setPayerName(e.target.value)}
                className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy text-lg font-semibold"
                placeholder="e.g. Blue Cross Blue Shield"
              />
            </div>

            <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
              <h2 className="text-xl font-bold text-slate-900 mb-1">
                Uploaded Files
                <InfoTip label="Uploaded Files">
                  Contracts and other PDFs for this payer. Fields tagged &ldquo;From uploaded files&rdquo; are filled
                  in from these. When you open a section with those fields, the files show next to the form so you
                  can read them while you type.
                </InfoTip>
              </h2>
              <p className="text-sm text-slate-500 mb-4">PDFs used to fill in the &ldquo;From uploaded files&rdquo; fields.</p>
              {isNew ? (
                <p className="text-sm text-slate-400 italic">Save the payer first, then you can upload files.</p>
              ) : (
                <PayerFiles payerId={payerId} previewHeight="60vh" />
              )}
            </div>

            <h1 className="text-4xl font-bold text-slate-900 mb-2">
              Payer Profile — Categories & Contents
              <InfoTip label="Sections">
                Click a section card to open it and fill in its fields. The grey number is how many fields it has.
                You can move between sections before saving; nothing is saved until you click Save. Saved values
                go live straight away (there is no review step here) and are recorded in Change History.
              </InfoTip>
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
                  className="bg-white rounded-lg shadow-sm hover:shadow-md transition-all p-6 text-left hover:border-navy border-2 border-transparent group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-900 group-hover:text-navy">
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
            <span className="inline-flex items-center">
              <button
                onClick={savePayer}
                disabled={saving}
                className="bg-navy hover:bg-navy-hover disabled:opacity-50 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
              >
                {saving ? 'Saving...' : 'Save All Changes'}
              </button>
              <InfoTip label="Save All Changes">
                Saves the payer name and every change you made in any section, then returns to the payer list.
              </InfoTip>
            </span>
            <span className="inline-flex items-center">
              <Link
                href="/"
                className="px-8 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-semibold transition-colors"
              >
                Cancel
              </Link>
              <InfoTip label="Cancel" align="right">
                Goes back to the payer list without saving. Any changes you haven&apos;t saved are lost.
              </InfoTip>
            </span>
          </div>
        </div>
      </main>
    )
  }

  // Detail view: Show selected section form
  const selectedSectionData = sections.find(s => s.key === activeSection)
  const sectionFields = fields.filter(f => f.section_key === activeSection)
  // Sections with "From uploaded files" fields show the payer's PDFs beside the form.
  const showFiles = !isNew && sectionFields.some(f => f.source_mode === 'file')

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className={`${showFiles ? 'max-w-[1600px] flex flex-col xl:flex-row gap-8 items-start' : 'max-w-4xl'} mx-auto p-8`}>
      <div className={showFiles ? 'w-full xl:w-1/2 min-w-0' : ''}>
        {/* Header */}
        <button
          onClick={() => setActiveSection(null)}
          className="inline-flex items-center text-navy hover:text-navy-hover mb-6 font-semibold"
        >
          ← Back to Sections
        </button>

        <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            {selectedSectionData?.label}
          </h1>
          <p className="text-slate-600">
            {sectionFields.length} fields to complete
            <InfoTip label="Filling in fields">
              Type each value in its box. The grey text under a field name explains what it means, and the coloured
              tag says how the field normally gets its value. Some fields can hold several values: use
              &ldquo;+ Add another&rdquo; to add one and Remove to delete one. Leave a box empty if you don&apos;t
              know the answer.
            </InfoTip>
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
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy"
                        placeholder={`Enter ${field.label}`}
                      />
                    )}
                    {fieldValues.map((fv, idx) => (
                      <div key={fv.id} className="flex gap-3">
                        <input
                          type={field.input_type === 'date' ? 'date' : 'text'}
                          value={fv.value}
                          onChange={e => updateFieldValue(field.id, idx, e.target.value)}
                          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy"
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
                      className="text-sm text-navy hover:text-navy-hover font-semibold mt-2"
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
                    className={`w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy ${
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
          <span className="inline-flex items-center">
            <button
              onClick={savePayer}
              disabled={saving}
              className="bg-navy hover:bg-navy-hover disabled:opacity-50 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <InfoTip label="Save Changes">
              Saves this section and any other sections you changed, then returns to the payer list. Saved values go
              live straight away and are recorded in Change History.
            </InfoTip>
          </span>
          <span className="inline-flex items-center">
            <button
              onClick={() => setActiveSection(null)}
              className="px-8 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-semibold transition-colors"
            >
              Back to Sections
            </button>
            <InfoTip label="Back to Sections">
              Returns to the section cards so you can fill in another section. Your changes are kept but not saved
              yet; click Save when you are done.
            </InfoTip>
          </span>
          <span className="inline-flex items-center">
            <Link
              href="/"
              className="px-8 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-semibold transition-colors"
            >
              Done
            </Link>
            <InfoTip label="Done" align="right">
              Goes back to the payer list <strong>without saving</strong>. Click Save Changes first if you want to
              keep what you typed.
            </InfoTip>
          </span>
        </div>
      </div>
      {showFiles && (
        <aside className="w-full xl:w-1/2 min-w-0 xl:sticky xl:top-8 bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-1">
            Uploaded Files
            <InfoTip label="Uploaded Files" align="right">
              The contracts and other PDFs uploaded for this payer. Use them to fill in the fields tagged
              &ldquo;From uploaded files&rdquo;. Click a file to preview it; managers and admins can upload more here.
            </InfoTip>
          </h2>
          <p className="text-sm text-slate-500 mb-4">Read these to fill in the &ldquo;From uploaded files&rdquo; fields.</p>
          <PayerFiles payerId={payerId} layout="side" previewHeight="70vh" />
        </aside>
      )}
      </div>
    </main>
  )
}
