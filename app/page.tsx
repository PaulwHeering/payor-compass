'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from './providers'

interface Payer {
  id: string
  name: string
  created_at: string
  updated_at: string
}

interface Section {
  key: string
  label: string
  position: number
}

interface Field {
  id: string
  section_key: string
  key: string
  position: number
}

interface CompletionBySection {
  [sectionKey: string]: number // percentage
}

export default function Home() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [payers, setPayers] = useState<Payer[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [fields, setFields] = useState<Field[]>([])
  const [completionMap, setCompletionMap] = useState<Map<string, CompletionBySection>>(new Map())
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [pendingFindings, setPendingFindings] = useState(0)

  useEffect(() => {
    if (userRole !== 'manager' && userRole !== 'admin') return
    supabase
      .from('findings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingFindings(count ?? 0))
  }, [userRole])

  useEffect(() => {
    if (!user) return

    const getUserRole = async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      setUserRole(data?.role || null)
    }

    getUserRole()
  }, [user])

  const handleLogout = async () => {
    await signOut()
    router.push('/auth/login')
  }

  let filteredPayers = payers.filter(payer =>
    payer.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Apply sorting
  if (sortBy) {
    filteredPayers = [...filteredPayers].sort((a, b) => {
      let aVal: any
      let bVal: any

      if (sortBy === 'name') {
        aVal = a.name
        bVal = b.name
      } else if (sortBy === 'updated') {
        aVal = new Date(a.updated_at).getTime()
        bVal = new Date(b.updated_at).getTime()
      } else {
        // Category column
        const completionA = completionMap.get(a.id) || {}
        const completionB = completionMap.get(b.id) || {}
        aVal = completionA[sortBy] ?? 0
        bVal = completionB[sortBy] ?? 0
      }

      if (aVal < bVal) return sortAsc ? -1 : 1
      if (aVal > bVal) return sortAsc ? 1 : -1
      return 0
    })
  }

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      setSortAsc(!sortAsc)
    } else {
      setSortBy(column)
      setSortAsc(true)
    }
  }

  const getSortIndicator = (column: string) => {
    if (sortBy !== column) return ''
    return sortAsc ? ' ↑' : ' ↓'
  }

  useEffect(() => {
    loadMetadata()
  }, [])

  const loadMetadata = async () => {
    setLoading(true)
    try {
      const [secRes, fieldRes, payerRes] = await Promise.all([
        supabase.from('sections').select('*').order('position'),
        supabase.from('field_definitions').select('*').order('position'),
        supabase.from('payers').select('*').order('name'),
      ])

      if (secRes.error) throw secRes.error
      if (fieldRes.error) throw fieldRes.error
      if (payerRes.error) throw payerRes.error

      setSections(secRes.data || [])
      setFields(fieldRes.data || [])
      setPayers(payerRes.data || [])

      // Calculate completion for each payer
      await calculateCompletionForAllPayers(payerRes.data || [], fieldRes.data || [])
    } catch (err) {
      console.error('Error loading data:', err)
    } finally {
      setLoading(false)
    }
  }

  const calculateCompletionForAllPayers = async (
    payersToCalc: Payer[],
    fieldsToCalc: Field[]
  ) => {
    const completions = new Map<string, CompletionBySection>()

    for (const payer of payersToCalc) {
      const { data: values } = await supabase
        .from('payer_values')
        .select('field_id')
        .eq('payer_id', payer.id)

      const filledFieldIds = new Set(values?.map(v => v.field_id) || [])
      const completion: CompletionBySection = {}

      for (const section of sections) {
        const sectionFields = fieldsToCalc.filter(f => f.section_key === section.key)
        const filledCount = sectionFields.filter(f => filledFieldIds.has(f.id)).length
        const percent = sectionFields.length > 0 ? Math.round((filledCount / sectionFields.length) * 100) : 0
        completion[section.key] = percent
      }

      completions.set(payer.id, completion)
    }

    setCompletionMap(completions)
  }

  const deletePayer = async (id: string) => {
    if (!confirm('Are you sure?')) return
    const { error } = await supabase.from('payers').delete().eq('id', id)
    if (error) {
      console.error('Error deleting payer:', error)
      alert('Failed to delete')
    } else {
      setPayers(payers.filter(p => p.id !== id))
      const newMap = new Map(completionMap)
      newMap.delete(id)
      setCompletionMap(newMap)
    }
  }

  const getCompletionColor = (percent: number): string => {
    if (percent === 0) return 'bg-red-100 text-red-700'
    if (percent < 50) return 'bg-orange-100 text-orange-700'
    if (percent < 100) return 'bg-yellow-100 text-yellow-700'
    return 'bg-green-100 text-green-700'
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50">
      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="mb-10">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-bold text-slate-900 mb-2">Payer Compass</h1>
              <p className="text-slate-600">Manage and track insurance payer information</p>
            </div>
            <div className="flex items-center gap-4">
              {(userRole === 'manager' || userRole === 'admin') && (
                <Link
                  href="/research"
                  className="border border-slate-300 hover:bg-slate-50 text-slate-700 px-5 py-3 rounded-lg font-semibold transition-colors"
                >
                  Research
                </Link>
              )}
              {(userRole === 'manager' || userRole === 'admin') && (
                <Link
                  href="/review"
                  className="border border-slate-300 hover:bg-slate-50 text-slate-700 px-5 py-3 rounded-lg font-semibold transition-colors"
                >
                  Review findings
                  {pendingFindings > 0 && (
                    <span className="ml-2 bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                      {pendingFindings}
                    </span>
                  )}
                </Link>
              )}
              <Link
                href="/payer/new"
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors shadow-md hover:shadow-lg"
              >
                + New Payer
              </Link>
              {user && (
                <div className="relative">
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
                      {user.email?.[0].toUpperCase() || 'U'}
                    </div>
                    <span className="text-sm font-medium text-slate-700 max-w-[120px] truncate">
                      {user.email?.split('@')[0]}
                    </span>
                  </button>
                  {userMenuOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-slate-200 z-50">
                      <div className="p-3 border-b border-slate-200">
                        <p className="text-sm font-medium text-slate-900">{user.email}</p>
                        {userRole && (
                          <p className="text-xs text-slate-500 mt-1">Role: {userRole}</p>
                        )}
                      </div>
                      {userRole === 'admin' && (
                        <>
                          <Link
                            href="/admin/job-titles"
                            className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-200"
                          >
                            Manage Job Titles
                          </Link>
                          <Link
                            href="/admin/field-sources"
                            className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-200"
                          >
                            Field Sources
                          </Link>
                        </>
                      )}
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search payers by name..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full px-5 py-3 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
            />
            <svg className="absolute right-4 top-3.5 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading...</p>
          </div>
        ) : (
          <>


            {filteredPayers.length === 0 ? (
              <div className="bg-white border border-slate-200 p-12 rounded-xl text-center shadow-sm">
                <div className="mb-4">
                  <svg className="w-12 h-12 mx-auto text-slate-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 21l-4.35-4.35m0 0A7.5 7.5 0 103.5 10.5" />
                  </svg>
                </div>
                <p className="text-slate-600 mb-4 text-lg">
                  {payers.length === 0 ? 'No payers yet' : 'No payers match your search'}
                </p>
                {payers.length === 0 && (
                  <Link
                    href="/payer/new"
                    className="text-blue-600 hover:text-blue-700 font-semibold transition-colors"
                  >
                    Create the first one →
                  </Link>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-md overflow-x-auto border border-slate-200">
                <table className="w-full">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
                    <tr>
                      <th
                        onClick={() => toggleSort('name')}
                        className="text-center px-6 py-4 font-semibold w-48 min-w-48 cursor-pointer hover:bg-slate-100 transition-colors text-slate-900"
                      >
                        Name{getSortIndicator('name')}
                      </th>
                      {sections.map(section => (
                        <th
                          key={section.key}
                          onClick={() => toggleSort(section.key)}
                          className="text-center px-4 py-4 font-semibold w-20 min-w-20 cursor-pointer hover:bg-slate-100 transition-colors text-slate-900"
                        >
                          <div className="text-xs font-semibold">{section.label}{getSortIndicator(section.key)}</div>
                        </th>
                      ))}
                      <th
                        onClick={() => toggleSort('updated')}
                        className="text-right px-6 py-4 font-semibold w-28 min-w-28 cursor-pointer hover:bg-slate-100 transition-colors text-slate-900"
                      >
                        Updated{getSortIndicator('updated')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayers.map((payer, idx) => {
                      const completion = completionMap.get(payer.id) || {}
                      return (
                        <tr key={payer.id} className={`border-b border-slate-200 hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                          <td className="px-6 py-4 sticky left-0 bg-inherit hover:bg-blue-50 text-center">
                            <Link
                              href={`/payer/${payer.id}/view`}
                              className="font-semibold text-slate-900 hover:text-blue-600 transition-colors cursor-pointer"
                            >
                              {payer.name}
                            </Link>
                          </td>
                          {sections.map(section => {
                            const percent = completion[section.key] ?? 0
                            return (
                              <td
                                key={section.key}
                                className="px-4 py-4 text-center"
                              >
                                <div className={`inline-block px-3 py-1 text-sm font-bold rounded-lg ${getCompletionColor(percent)}`}>
                                  {percent}%
                                </div>
                              </td>
                            )
                          })}
                          <td className="px-6 py-4 text-sm text-slate-600 text-right">
                            {new Date(payer.updated_at).toLocaleDateString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
