'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/app/providers'

interface JobTitle {
  id: string
  title: string
  role: 'admin' | 'manager' | 'viewer'
  enabled: boolean
}

export default function JobTitlesPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'manager' | 'viewer'>('viewer')
  const [saving, setSaving] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return

    const checkAccess = async () => {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile?.role !== 'admin') {
        router.push('/')
        return
      }

      setUserRole(profile.role)
      loadJobTitles()
    }

    checkAccess()
  }, [user, router])

  const loadJobTitles = async () => {
    try {
      const { data, error } = await supabase
        .from('job_titles')
        .select('*')
        .order('title')

      if (error) throw error
      setJobTitles(data || [])
    } catch (err) {
      console.error('Error loading job titles:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAddJobTitle = async () => {
    if (!newTitle.trim()) return

    setSaving(true)
    try {
      const { error } = await supabase.from('job_titles').insert({
        title: newTitle.trim(),
        role: newRole,
        enabled: true,
      })

      if (error) throw error
      setNewTitle('')
      setNewRole('viewer')
      await loadJobTitles()
    } catch (err) {
      console.error('Error adding job title:', err)
      alert('Failed to add job title')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = async (id: string, currentEnabled: boolean) => {
    try {
      const { error } = await supabase
        .from('job_titles')
        .update({ enabled: !currentEnabled })
        .eq('id', id)

      if (error) throw error
      await loadJobTitles()
    } catch (err) {
      console.error('Error updating job title:', err)
    }
  }

  const handleDeleteJobTitle = async (id: string) => {
    if (!confirm('Are you sure you want to delete this job title?')) return

    try {
      const { error } = await supabase.from('job_titles').delete().eq('id', id)

      if (error) throw error
      await loadJobTitles()
    } catch (err) {
      console.error('Error deleting job title:', err)
    }
  }

  if (userRole !== 'admin') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600 mb-4">You do not have permission to access this page.</p>
          <Link href="/" className="text-blue-600 hover:underline">
            Return to Payer Compass
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50">
      <div className="max-w-4xl mx-auto p-8">
        <div className="mb-8">
          <Link href="/" className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-6">
            ← Back to Payer Compass
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Job Titles Management</h1>
          <p className="text-slate-600">Configure which job titles can access the application and their roles</p>
        </div>

        {/* Add New Job Title */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Job Title</h2>
          <div className="flex gap-4">
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="e.g., Clinical Director"
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value as any)}
              className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="viewer">Viewer</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
            <button
              onClick={handleAddJobTitle}
              disabled={saving || !newTitle.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
            >
              {saving ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>

        {/* Job Titles List */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading...</div>
          ) : jobTitles.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No job titles configured yet</div>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-6 py-4 font-semibold text-slate-900">Job Title</th>
                  <th className="text-left px-6 py-4 font-semibold text-slate-900">Role</th>
                  <th className="text-left px-6 py-4 font-semibold text-slate-900">Status</th>
                  <th className="text-right px-6 py-4 font-semibold text-slate-900">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobTitles.map(jobTitle => (
                  <tr key={jobTitle.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-900">{jobTitle.title}</td>
                    <td className="px-6 py-4">
                      <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700">
                        {jobTitle.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                          jobTitle.enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {jobTitle.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => handleToggleEnabled(jobTitle.id, jobTitle.enabled)}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        {jobTitle.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => handleDeleteJobTitle(jobTitle.id)}
                        className="text-sm text-red-600 hover:text-red-700 font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-8 p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-semibold text-blue-900 mb-2">Role Permissions</h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li>
              <strong>Viewer:</strong> Can view payer information (read-only)
            </li>
            <li>
              <strong>Manager:</strong> Can view and edit payer information
            </li>
            <li>
              <strong>Admin:</strong> Full access including job title management
            </li>
          </ul>
        </div>
      </div>
    </main>
  )
}
