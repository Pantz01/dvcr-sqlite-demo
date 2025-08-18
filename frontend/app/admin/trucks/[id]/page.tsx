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

type Note = { id: number; text: string; created_at: string; author: { name: string } }

type Defect = {
  id: number
  component: string
  severity: string
  description?: string | null
  resolved: boolean
}

type Report = {
  id: number
  created_at: string
  odometer?: number | null
  status: 'OPEN' | 'CLOSED' | string
  summary?: string | null
  defects?: Defect[]
  notes?: Note[]
}

type FlatIssue = Defect & {
  _report_id: number
  _reported_at: string
  _report_notes: Note[]
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

  // Issues (flattened across all reports)
  const [allIssues, setAllIssues] = useState<FlatIssue[]>([])
  const [expandedNotes, setExpandedNotes] = useState<Record<number, boolean>>({}) // defectId -> open?

  // Pagination
  const PAGE_SIZE = 25
  const [page, setPage] = useState(1)

  useEffect(() => {
    loadTruck()
    loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckId])

  async function loadTruck() {
    setError(null)
    const r = await fetch(`${API}/trucks/${truckId}`, { headers: authHeaders() })
    if (!r.ok) { setError(await r.text()); return }
    setTruck(await r.json())
  }

  async function loadReports() {
    setError(null)
    setLoading(true)
    const r = await fetch(`${API}/trucks/${truckId}/reports?limit=500`, { headers: authHeaders() })
    setLoading(false)
    if (!r.ok) { setError(await r.text()); return }
    const list: Report[] = await r.json()
    setReports(list)
    setAllIssues(buildAllIssuesFromReports(list))
    setPage(1) // reset to first page when reloading
  }

  function buildAllIssuesFromReports(list: Report[]): FlatIssue[] {
    const out: FlatIssue[] = []
    for (const rep of list) {
      const repNotes = rep.notes ?? []
      for (const d of rep.defects ?? []) {
        out.push({
          ...d,
          _report_id: rep.id,
          _reported_at: rep.created_at,
          _report_notes: repNotes,
        })
      }
    }
    // newest first by reported_at
    out.sort((a, b) => new Date(b._reported_at).getTime() - new Date(a._reported_at).getTime())
    return out
  }

  // --- Issue actions ---
  async function editIssue(d: FlatIssue) {
    const next = prompt('Edit issue', d.description || '') ?? ''
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ description: next }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await loadReports()
  }

  async function toggleResolved(d: FlatIssue) {
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ resolved: !d.resolved }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await loadReports()
  }

  async function deleteIssue(d: FlatIssue) {
    if (!confirm('Delete this issue?')) return
    const r = await fetch(`${API}/defects/${d.id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    await loadReports()
  }

  // --- Pagination helpers ---
  const pageCount = Math.max(1, Math.ceil(allIssues.length / PAGE_SIZE))
  const pagedIssues = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return allIssues.slice(start, start + PAGE_SIZE)
  }, [allIssues, page])

  function prevPage() { setPage(p => Math.max(1, p - 1)) }
  function nextPage() { setPage(p => Math.min(pageCount, p + 1)) }

  // --- CSV export (minimal fields only) ---
  function exportAllIssuesCsv() {
    const rows = allIssues.map(d => {
      const issueDate = new Date(d._reported_at).toISOString()
      const issueText = d.description ?? ''
      const resolvedDate = d.resolved ? '' : 'Unresolved' // no resolved_at in backend; leave blank if resolved
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
    if (rows.length === 0) {
      lines.push([ '', '', '' ].join(','))
    } else {
      for (const row of rows) {
        lines.push(headers.map(h => escapeCell((row as any)[h])).join(','))
      }
    }

    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    a.download = `truck-${truck?.number ?? truckId}-issues-${ts}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">
        {truck ? `Truck ${truck.number}` : 'Truck'}
      </h1>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Truck details (read-only) */}
      <div className="border rounded-2xl p-4 text-sm">
        {truck ? (
          <div className="grid sm:grid-cols-4 gap-2">
            <div><span className="text-gray-600">Truck #</span> <b>{truck.number}</b></div>
            <div><span className="text-gray-600">VIN</span> <b>{truck.vin || '—'}</b></div>
            <div><span className="text-gray-600">Odometer</span> <b>{truck.odometer ?? 0}</b></div>
            <div><span className="text-gray-600">Status</span> <b>{truck.active ? 'Active' : 'Inactive'}</b></div>
          </div>
        ) : (
          <div className="text-gray-500">Loading truck…</div>
        )}
      </div>

      {/* Controls: export + pagination */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={exportAllIssuesCsv}
          className="border px-3 py-1 rounded-xl"
        >
          Export Issues (CSV)
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={prevPage}
            disabled={page <= 1}
            className="border px-3 py-1 rounded-xl disabled:opacity-50"
          >
            Prev
          </button>
          <div className="text-sm">
            Page {page} / {pageCount} · {allIssues.length} total
          </div>
          <button
            onClick={nextPage}
            disabled={page >= pageCount}
            className="border px-3 py-1 rounded-xl disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {/* Issues list (active + previous) */}
      <section className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b">Issues</div>

        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading…</div>
        ) : allIssues.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No issues found for this truck.</div>
        ) : (
          <div className="divide-y">
            {pagedIssues.map(d => (
              <div key={d.id} className="p-3 text-sm">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="font-medium">{d.description || '(no description)'}</div>
                    <div className="text-xs text-gray-600">
                      {d.resolved ? 'Resolved' : 'Unresolved'} · Reported {new Date(d._reported_at).toLocaleString()}
                    </div>
                  </div>
                  <button className="text-xs underline" onClick={() => editIssue(d)}>Edit</button>
                  <button className="text-xs underline" onClick={() => toggleResolved(d)}>
                    {d.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                  <button className="text-xs underline text-red-600" onClick={() => deleteIssue(d)}>Delete</button>
                </div>

                {/* Tidy, collapsible notes (per *report*) */}
                {!!(d._report_notes?.length) && (
                  <div className="mt-2">
                    <button
                      className="text-xs underline"
                      onClick={() =>
                        setExpandedNotes(prev => ({ ...prev, [d.id]: !prev[d.id] }))
                      }
                    >
                      {expandedNotes[d.id] ? 'Hide notes' : `Show notes (${d._report_notes.length})`}
                    </button>
                    {expandedNotes[d.id] && (
                      <ul className="mt-2 space-y-2">
                        {d._report_notes.map(n => (
                          <li key={n.id} className="border rounded-md p-2">
                            <div className="text-[11px] text-gray-600">
                              {n.author?.name || 'User'} • {new Date(n.created_at).toLocaleString()}
                            </div>
                            <div>{n.text}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
