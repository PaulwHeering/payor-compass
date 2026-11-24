'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import InfoTip from '@/app/components/InfoTip'

// Uploaded PDFs for one payer (contracts, fee schedules, etc.). They are used to fill in the fields tagged
// "From uploaded files". Files are stored in the private Supabase storage bucket 'payer-files' and listed
// in the payer_files table. Anyone signed in can preview; only managers and admins can upload or delete.

const BUCKET = 'payer-files'
const MAX_BYTES = 50 * 1024 * 1024

export interface PayerFile {
  id: string
  payer_id: string
  storage_path: string
  file_name: string
  description: string | null
  size_bytes: number | null
  uploaded_by_email: string | null
  created_at: string
}

function fetchFiles(payerId: string) {
  return supabase
    .from('payer_files')
    .select('id, payer_id, storage_path, file_name, description, size_bytes, uploaded_by_email, created_at')
    .eq('payer_id', payerId)
    .order('created_at', { ascending: false })
    .returns<PayerFile[]>()
}

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function PayerFiles({
  payerId,
  layout = 'stacked',
  previewHeight = '75vh',
}: {
  payerId: string
  // stacked: list above a full-width preview. side: narrow column (list, then preview) for the edit form.
  layout?: 'stacked' | 'side'
  previewHeight?: string
}) {
  const [files, setFiles] = useState<PayerFile[]>([])
  const [loading, setLoading] = useState(true)
  const [canEdit, setCanEdit] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null)
  const [description, setDescription] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const loadFiles = useCallback(async () => {
    const { data, error } = await fetchFiles(payerId)
    if (error) {
      setError('Could not load the uploaded files.')
      console.error('Error loading payer files:', error)
    } else {
      setFiles(data ?? [])
      setSelectedId(prev => (prev && data?.some(f => f.id === prev) ? prev : data?.[0]?.id ?? null))
    }
    setLoading(false)
  }, [payerId])

  useEffect(() => {
    let cancelled = false
    fetchFiles(payerId).then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        setError('Could not load the uploaded files.')
        console.error('Error loading payer files:', error)
      } else {
        setFiles(data ?? [])
        setSelectedId(data?.[0]?.id ?? null)
      }
      setLoading(false)
    })
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
      if (!cancelled) setCanEdit(data?.role === 'manager' || data?.role === 'admin')
    })
    return () => {
      cancelled = true
    }
  }, [payerId])

  const selected = files.find(f => f.id === selectedId) ?? null

  // Signed links expire after an hour, so a fresh one is made whenever a file is selected.
  const selectedPath = selected?.storage_path ?? null
  useEffect(() => {
    if (!selectedPath) return
    let cancelled = false
    const path = selectedPath
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setError('Could not open this file.')
          console.error('Error creating signed URL:', error)
        } else {
          setSigned({ path, url: data.signedUrl })
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedPath])

  const previewUrl = selected && signed?.path === selected.storage_path ? signed.url : null

  const upload = async (file: File) => {
    setError(null)
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files can be uploaded.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('This file is larger than 50 MB.')
      return
    }
    setUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('You are not signed in.')
      const path = `${payerId}/${crypto.randomUUID()}.pdf`
      const up = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: 'application/pdf', upsert: false })
      if (up.error) throw up.error

      const { data, error } = await supabase
        .from('payer_files')
        .insert({
          payer_id: payerId,
          storage_path: path,
          file_name: file.name,
          description: description.trim() || null,
          size_bytes: file.size,
          uploaded_by: user.id,
          uploaded_by_email: user.email ?? null,
        })
        .select('id')
        .single()
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]) // don't leave an unlisted file behind
        throw error
      }
      setDescription('')
      await loadFiles()
      setSelectedId(data.id)
    } catch (err) {
      console.error('Error uploading file:', err)
      setError(err instanceof Error ? `Upload failed: ${err.message}` : 'Upload failed.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async (file: PayerFile) => {
    if (!confirm(`Delete "${file.file_name}"? This cannot be undone.`)) return
    setError(null)
    const { error } = await supabase.from('payer_files').delete().eq('id', file.id)
    if (error) {
      setError('Could not delete the file.')
      console.error('Error deleting payer file row:', error)
      return
    }
    const st = await supabase.storage.from(BUCKET).remove([file.storage_path])
    if (st.error) console.error('Error deleting stored file:', st.error)
    await loadFiles()
  }

  const list = (
    <div>
      {canEdit && (
        <div className="mb-4 space-y-2">
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional), e.g. 2026 commercial contract"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="inline-flex items-center">
            <label
              className={`inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg font-semibold cursor-pointer transition-colors ${
                uploading ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              {uploading ? 'Uploading...' : 'Upload PDF'}
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                disabled={uploading}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) upload(f)
                }}
              />
            </label>
            <InfoTip label="Upload PDF">
              Adds a PDF (up to 50 MB) to this payer, such as a contract or fee schedule. It is stored securely in
              Payor Compass and anyone signed in can preview it here. Type a description first if you want one.
            </InfoTip>
          </span>
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading files...</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          No files uploaded yet.{!canEdit && ' A manager or admin can upload them.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {files.map(f => (
            <li
              key={f.id}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                f.id === selectedId ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <button onClick={() => setSelectedId(f.id)} className="flex-1 text-left min-w-0">
                <span className="block text-sm font-semibold text-slate-800 truncate">📄 {f.file_name}</span>
                {f.description && <span className="block text-xs text-slate-600">{f.description}</span>}
                <span className="block text-xs text-slate-400">
                  {new Date(f.created_at).toLocaleDateString()}
                  {f.uploaded_by_email && ` · ${f.uploaded_by_email}`}
                  {f.size_bytes ? ` · ${formatSize(f.size_bytes)}` : ''}
                </span>
              </button>
              {canEdit && (
                <button
                  onClick={() => remove(f)}
                  className="text-xs text-red-600 hover:text-red-700 font-medium shrink-0 mt-0.5"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const preview = selected && (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-sm font-semibold text-slate-700 truncate">{selected.file_name}</p>
        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-700 font-semibold shrink-0"
          >
            Open in new tab ↗
          </a>
        )}
      </div>
      {previewUrl ? (
        <iframe
          key={previewUrl}
          src={previewUrl}
          title={`Preview of ${selected.file_name}`}
          className="w-full rounded-lg border border-slate-200 bg-slate-100"
          style={{ height: previewHeight }}
        />
      ) : (
        <div
          className="w-full rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-sm text-slate-500"
          style={{ height: previewHeight }}
        >
          Loading preview...
        </div>
      )}
    </div>
  )

  if (layout === 'side') {
    return (
      <div className="space-y-4">
        {list}
        {preview}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">{list}</div>
      <div className="lg:col-span-2">
        {preview ?? (
          <p className="text-sm text-slate-400 italic">Select a file to preview it here.</p>
        )}
      </div>
    </div>
  )
}
