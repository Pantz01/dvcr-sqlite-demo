'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

type Truck = {
  id: number
  number: string
  vin?: string | null
  active: boolean
  odometer: number
}

type Note = {
  id: number
  text: string
  created_at: string
  author: { name: string }
}

type Defect = {
  id: number
  component: string
  severity: string
  description?: string | null
  resolved: boolean
  resolved_at?: string | null
  _reported_at: string
  _report_id: number
  // ⬇️ NEW: notes are now per-defect
  notes?: Note[]
}

type Report = {
  id: number
  created_at: string
  odometer?: number | null
  status: 'OPEN' | 'CLOSED' | string
  summary?: string | null
  defects?: Omit<Defect, '_reported_at' | '_report_id'>[]
  notes?: Note[] // (kept for compatibility, but not used for issue notes anymore)
}

export default function AdminTruckPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <TruckInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function TruckInner() {
  const params = useParams() as { id: string }
  const truckId = Number(params.id)

  const [truck, setTruck] = useState<Truck | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // pagination (25/page)
  const [activePage, setActivePage] = useState(1)
  const [prevPage, setPrevPage] = useState(1)
  const PAGE_SIZE = 25

  // per-issue notes UI
  const [openNotes, setOpenNotes] = useState<Record<number, boolean>>({})
  const [newNoteText, setNewNoteText] = useState<Record<number, string>>({}) // keyed by defect.id

  useEffect(() => {
    setError(null)
    setLoading(true)
    ;(async () => {
      try {
        const t = await fetch(`${API}/trucks/${truckId}`, { headers: authHeaders() })
        if (!t.ok) throw new Error(await t.text())
        setTruck(await t.json())

        const r = await fetch(`${API}/trucks/${truckId}/reports?limit=2000`, { headers: authHeaders() })
        if (!r.ok) throw new Error(await r.text())
        const list: Report[] = await r.json()

        // hydrate each report (ensures defects include photos + notes)
        const full = await Promise.all(
          list.map(async (rp) => {
            const rr = await fetch(`${API}/reports/${rp.id}`, { headers: authHeaders() })
            if (!rr.ok) return rp
            return await rr.json()
          })
        )
        setReports(full)
      } catch (e: any) {
        setError(e?.message || 'Failed to load truck data')
      } finally {
        setLoading(false)
      }
    })()
  }, [truckId])

  // Flatten defects and stamp report meta (carry through defect.notes)
  const allIssues: Defect[] = useMemo(() => {
    const rows: Defect[] = []
    for (const r of reports) {
      const ds = r.defects || []
      for (const d of ds) {
        rows.push({ ...(d as any), _reported_at: r.created_at, _report_id: r.id })
      }
    }
    rows.sort((a, b) => new Date(b._reported_at).getTime() - new Date(a._reported_at).getTime())
    return rows
  }, [reports])

  const activeIssues = useMemo(() => allIssues.filter(d => !d.resolved), [allIssues])
  const previousIssues = useMemo(() => allIssues.filter(d => d.resolved), [allIssues])

  const activeTotalPages = Math.max(1, Math.ceil(activeIssues.length / PAGE_SIZE))
  const prevTotalPages   = Math.max(1, Math.ceil(previousIssues.length / PAGE_SIZE))

  const activeSlice = useMemo(() => {
    const start = (activePage - 1) * PAGE_SIZE
    return activeIssues.slice(start, start + PAGE_SIZE)
  }, [activeIssues, activePage])

  const previousSlice = useMemo(() => {
    const start = (prevPage - 1) * PAGE_SIZE
    return previousIssues.slice(start, start + PAGE_SIZE)
  }, [previousIssues, prevPage])

  async function reloadAfterChange() {
    try {
      const r = await fetch(`${API}/trucks/${truckId}/reports?limit=2000`, { headers: authHeaders() })
      if (!r.ok) return
      const list: Report[] = await r.json()
      const full = await Promise.all(
        list.map(async (rp) => {
          const rr = await fetch(`${API}/reports/${rp.id}`, { headers: authHeaders() })
          if (!rr.ok) return rp
          return await rr.json()
        })
      )
      setReports(full)
    } catch {}
  }

  async function editIssue(d: Defect) {
    const next = prompt('Edit issue', d.description || '') ?? ''
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ description: next }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadAfterChange()
  }

  async function toggleResolved(d: Defect) {
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ resolved: !d.resolved }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadAfterChange()
  }

  async function deleteIssue(d: Defect) {
    if (!confirm('Delete this issue?')) return
    const r = await fetch(`${API}/defects/${d.id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    await reloadAfterChange()
  }

  // ⬇️ CHANGED: add a note to a specific defect (not to the report)
  async function addNoteForDefect(defectId: number) {
    const text = (newNoteText[defectId] || '').trim()
    if (!text) return
    const r = await fetch(`${API}/defects/${defectId}/notes`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ text }),
    })
    if (!r.ok) { alert(await r.text()); return }
    setNewNoteText(prev => ({ ...prev, [defectId]: '' }))
    await reloadAfterChange()
  }

  // Export CSV (Date of Issue, Issue, Date Resolved / Status)
  function exportAllIssuesCsv() {
    const rows = allIssues.map(d => {
      const issueDate = new Date(d._reported_at).toISOString()
      const issueText = d.description ?? ''
      const resolvedDate = d.resolved
        ? (d as any).resolved_at
          ? new Date((d as any).resolved_at as string).toISOString()
          : ''
        : 'Unresolved'
      return {
        'Date of Issue': issueDate,
        'Issue': issueText,
        'Date Resolved / Status': resolvedDate,
      }
    })
    const headers = ['Date of Issue', 'Issue', 'Date Resolved / Status']
    const escapeCell = (v: any) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines: string[] = []
    lines.push(headers.join(','))
    if (rows.length === 0) lines.push([ '', '', '' ].join(','))
    else for (const row of rows) lines.push(headers.map(h => escapeCell((row as any)[h])).join(','))
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    a.download = `truck-${truck?.number ?? truckId}-issues-${ts}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (loading) return <main className="p-6">Loading…</main>

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">{truck ? `Truck ${truck.number}` : 'Truck'}</h1>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Truck summary */}
      <div className="border rounded-2xl p-4 text-sm">
        {truck ? (
          <div className="grid sm:grid-cols-4 gap-2">
            <div><span className="text-gray-600">Truck #</span> <b>{truck.number}</b></div>
            <div><span className="text-gray-600">VIN</span> <b>{truck.vin || '—'}</b></div>
            <div><span className="text-gray-600">Odometer</span> <b>{truck.odometer ?? 0}</b></div>
            <div><span className="text-gray-600">Status</span> <b>{truck.active ? 'Active' : 'Inactive'}</b></div>
          </div>
        ) : (
          <div className="text-gray-500">Truck not found.</div>
        )}
      </div>

      {/* Top action: Export */}
      <div className="flex items-center justify-end">
        <button onClick={exportAllIssuesCsv} className="border rounded-xl px-3 py-1.5">
          Export CSV
        </button>
      </div>

      {/* ACTIVE ISSUES (with per-issue notes toggle + add note) */}
      <section className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b flex items-center justify-between">
          <span>Active Issues</span>
          <span className="text-xs text-gray-500">{activeIssues.length} total</span>
        </div>

        {activeIssues.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No active issues.</div>
        ) : (
          <>
            <div className="divide-y">
              {activeSlice.map(d => {
                const notes = d.notes || []  // ⬅️ notes now come from the defect
                const isOpen = !!openNotes[d.id]
                return (
                  <div key={d.id} className="p-3 text-sm">
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="font-medium">{d.description || '(no description)'}</div>
                        <div className="text-xs text-gray-600">
                          Reported {new Date(d._reported_at).toLocaleString()}
                        </div>
                      </div>
                      <button className="text-xs underline" onClick={() => editIssue(d)}>Edit</button>
                      <button className="text-xs underline" onClick={() => toggleResolved(d)}>Resolve</button>
                      <button className="text-xs underline text-red-600" onClick={() => deleteIssue(d)}>Delete</button>
                    </div>

                    {/* Notes toggle + list + add note */}
                    <div className="mt-2">
                      <button
                        className="text-xs underline"
                        onClick={() => setOpenNotes(prev => ({ ...prev, [d.id]: !prev[d.id] }))}
                      >
                        {isOpen ? 'Hide notes' : `Show notes (${notes.length})`}
                      </button>

                      {isOpen && (
                        <div className="mt-2 rounded-lg border">
                          {notes.length === 0 ? (
                            <div className="p-3 text-xs text-gray-500">No notes for this issue.</div>
                          ) : (
                            notes.map(n => (
                              <div key={n.id} className="p-3 border-t first:border-t-0">
                                <div className="text-[11px] text-gray-600">
                                  {n.author?.name || 'Unknown'} • {new Date(n.created_at).toLocaleString()}
                                </div>
                                <div className="text-sm">{n.text}</div>
                              </div>
                            ))
                          )}

                          {/* Add note inline */}
                          <div className="p-3 border-t flex items-center gap-2">
                            <input
                              value={newNoteText[d.id] || ''}
                              onChange={(e) => setNewNoteText(prev => ({ ...prev, [d.id]: e.target.value }))}
                              placeholder="Add a note"
                              className="border p-2 rounded-lg flex-1"
                            />
                            <button
                              className="border rounded-lg px-3 py-1.5 text-xs"
                              onClick={() => addNoteForDefect(d.id)}
                            >
                              Add note
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Active pagination */}
            <div className="flex items-center justify-between p-3 text-xs">
              <span>Page {activePage} of {activeTotalPages}</span>
              <div className="space-x-2">
                <button
                  className="border rounded px-2 py-1 disabled:opacity-50"
                  disabled={activePage <= 1}
                  onClick={() => setActivePage(p => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  className="border rounded px-2 py-1 disabled:opacity-50"
                  disabled={activePage >= activeTotalPages}
                  onClick={() => setActivePage(p => Math.min(activeTotalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* PREVIOUS (RESOLVED) ISSUES (notes + add note) */}
      <section className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b flex items-center justify-between">
          <span>Previous Issues (Resolved)</span>
          <span className="text-xs text-gray-500">{previousIssues.length} total</span>
        </div>

        {previousIssues.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No resolved issues yet.</div>
        ) : (
          <>
            <div className="divide-y">
              {previousSlice.map(d => {
                const notes = d.notes || []  // ⬅️ notes now come from the defect
                const isOpen = !!openNotes[d.id]
                return (
                  <div key={d.id} className="p-3 text-sm">
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="font-medium">{d.description || '(no description)'}</div>
                        <div className="text-xs text-gray-600">
                          Reported {new Date(d._reported_at).toLocaleString()} · Resolved {d.resolved_at ? new Date(d.resolved_at).toLocaleString() : '(date not recorded)'}
                        </div>
                      </div>
                      <button className="text-xs underline" onClick={() => editIssue(d)}>Edit</button>
                      <button className="text-xs underline" onClick={() => toggleResolved(d)}>Reopen</button>
                      <button className="text-xs underline text-red-600" onClick={() => deleteIssue(d)}>Delete</button>
                    </div>

                    {/* Notes toggle + list + add note */}
                    <div className="mt-2">
                      <button
                        className="text-xs underline"
                        onClick={() => setOpenNotes(prev => ({ ...prev, [d.id]: !prev[d.id] }))}
                      >
                        {isOpen ? 'Hide notes' : `Show notes (${notes.length})`}
                      </button>

                      {isOpen && (
                        <div className="mt-2 rounded-lg border">
                          {notes.length === 0 ? (
                            <div className="p-3 text-xs text-gray-500">No notes for this issue.</div>
                          ) : (
                            notes.map(n => (
                              <div key={n.id} className="p-3 border-t first:border-t-0">
                                <div className="text-[11px] text-gray-600">
                                  {n.author?.name || 'Unknown'} • {new Date(n.created_at).toLocaleString()}
                                </div>
                                <div className="text-sm">{n.text}</div>
                              </div>
                            ))
                          )}

                          {/* Add note inline */}
                          <div className="p-3 border-t flex items-center gap-2">
                            <input
                              value={newNoteText[d.id] || ''}
                              onChange={(e) => setNewNoteText(prev => ({ ...prev, [d.id]: e.target.value }))}
                              placeholder="Add a note"
                              className="border p-2 rounded-lg flex-1"
                            />
                            <button
                              className="border rounded-lg px-3 py-1.5 text-xs"
                              onClick={() => addNoteForDefect(d.id)}
                            >
                              Add note
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Previous pagination */}
            <div className="flex items-center justify-between p-3 text-xs">
              <span>Page {prevPage} of {prevTotalPages}</span>
              <div className="space-x-2">
                <button
                  className="border rounded px-2 py-1 disabled:opacity-50"
                  disabled={prevPage <= 1}
                  onClick={() => setPrevPage(p => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  className="border rounded px-2 py-1 disabled:opacity-50"
                  disabled={prevPage >= prevTotalPages}
                  onClick={() => setPrevPage(p => Math.min(prevTotalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
