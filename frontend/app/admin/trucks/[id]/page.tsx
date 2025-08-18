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
  resolved_at?: string | null   // ← include resolved timestamp
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

export default function AdminTruckReportsPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <PageInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function PageInner() {
  const params = useParams() as { id: string }
  const truckId = Number(params.id)

  const [truck, setTruck] = useState<Truck | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // add-issue form (still available on this page if you want)
  const [newIssue, setNewIssue] = useState('')
  const [busy, setBusy] = useState(false)

  // notes visibility per defect id
  const [openNotes, setOpenNotes] = useState<Record<number, boolean>>({})

  // pagination (25 per page)
  const PAGE_SIZE = 25
  const [activePage, setActivePage] = useState(1)
  const [previousPage, setPreviousPage] = useState(1)

  useEffect(() => {
    loadTruckAndReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckId])

  async function loadTruckAndReports() {
    setError(null)
    setLoading(true)
    try {
      const [t, r] = await Promise.all([
        fetch(`${API}/trucks/${truckId}`, { headers: authHeaders() }),
        fetch(`${API}/trucks/${truckId}/reports?limit=2000`, { headers: authHeaders() }), // grab a lot; we page on the client
      ])
      if (t.ok) setTruck(await t.json())
      else setTruck(null)

      if (r.ok) setReports(await r.json())
      else setReports([])
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function reloadReports() {
    try {
      const r = await fetch(`${API}/trucks/${truckId}/reports?limit=2000`, { headers: authHeaders() })
      if (r.ok) setReports(await r.json())
    } catch {}
  }

  // Add a new issue to the newest (or a new) report
  async function addIssue() {
    const text = newIssue.trim()
    if (!text) return
    setBusy(true)
    try {
      // Prefer the most recent report; if none exists, create one quickly
      let target: Report | null = reports[0] || null
      if (!target) {
        const cr = await fetch(`${API}/trucks/${truckId}/reports`, {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({ type: 'pre', odometer: truck?.odometer || 0, summary: '' }),
        })
        if (!cr.ok) { alert(await cr.text()); return }
        target = await cr.json()
        setReports(prev => [target!, ...prev])
      }

      const r = await fetch(`${API}/reports/${target!.id}/defects`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ component: 'general', severity: 'minor', description: text }),
      })
      if (!r.ok) { alert(await r.text()); return }
      setNewIssue('')
      await reloadReports()
    } finally {
      setBusy(false)
    }
  }

  async function editIssue(d: Defect) {
    const next = prompt('Edit issue', d.description || '') ?? ''
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ description: next }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadReports()
  }

  async function toggleResolved(d: Defect) {
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ resolved: !d.resolved }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadReports()
  }

  async function deleteIssue(d: Defect) {
    if (!confirm('Delete this issue?')) return
    const r = await fetch(`${API}/defects/${d.id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    await reloadReports()
  }

  // Flatten all defects for this truck and attach the report created_at as "_reported_at"
  type FlatIssue = Defect & { _report_id: number; _reported_at: string }
  const allIssues: FlatIssue[] = useMemo(() => {
    const out: FlatIssue[] = []
    for (const rep of reports) {
      for (const d of rep.defects || []) {
        out.push({ ...d, _report_id: rep.id, _reported_at: rep.created_at })
      }
    }
    // newest first by reported date
    out.sort((a, b) => new Date(b._reported_at).getTime() - new Date(a._reported_at).getTime())
    return out
  }, [reports])

  const activeIssues = allIssues.filter(d => !d.resolved)
  const previousIssues = allIssues.filter(d => d.resolved)

  // paginate helpers
  const activeTotalPages = Math.max(1, Math.ceil(activeIssues.length / PAGE_SIZE))
  const prevTotalPages = Math.max(1, Math.ceil(previousIssues.length / PAGE_SIZE))

  const activeSlice = activeIssues.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)
  const previousSlice = previousIssues.slice((previousPage - 1) * PAGE_SIZE, previousPage * PAGE_SIZE)

  // CSV export: Date of Issue, Issue, Date Resolved / Status
  function exportAllIssuesCsv() {
    const rows = allIssues.map(d => {
      const issueDate = new Date(d._reported_at).toISOString()
      const issueText = d.description ?? ''
      const resolvedCell =
        d.resolved
          ? (d.resolved_at ? new Date(d.resolved_at).toISOString() : '')
          : 'Unresolved'
      return {
        'Date of Issue': issueDate,
        'Issue': issueText,
        'Date Resolved / Status': resolvedCell,
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
      lines.push(['', '', ''].join(','))
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

  if (loading && !truck) return <main className="p-6">Loading…</main>

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">
        {truck ? `Truck ${truck.number}` : 'Truck'}
      </h1>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Quick add issue */}
      <section className="border rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Add Issue</div>
          <button
            onClick={exportAllIssuesCsv}
            className="text-sm border rounded-xl px-3 py-1.5"
            title="Export all issues for this truck"
          >
            Export CSV
          </button>
        </div>
        <div className="grid sm:grid-cols-5 gap-2">
          <input
            className="border p-2 rounded-xl sm:col-span-4"
            placeholder="Add an issue (e.g., brake light out)"
            value={newIssue}
            onChange={(e) => setNewIssue(e.target.value)}
          />
          <button className="border rounded-xl p-2" disabled={busy} onClick={addIssue}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </section>

      {/* Active Issues */}
      <section className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b flex items-center justify-between">
          <span>Active Issues</span>
          <span className="text-xs text-gray-600">
            Showing {activeSlice.length} of {activeIssues.length}
          </span>
        </div>
        {activeIssues.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">No active issues.</div>
        ) : (
          <>
            <div className="divide-y">
              {activeSlice.map(d => (
                <IssueRow
                  key={`a-${d.id}`}
                  d={d}
                  openNotes={openNotes}
                  setOpenNotes={setOpenNotes}
                  onEdit={editIssue}
                  onToggle={toggleResolved}
                  onDelete={deleteIssue}
                />
              ))}
            </div>
            <Pager page={activePage} totalPages={activeTotalPages} onPage={setActivePage} />
          </>
        )}
      </section>

      {/* Previous Issues (resolved) */}
      <section className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b flex items-center justify-between">
          <span>Previous Issues</span>
          <span className="text-xs text-gray-600">
            Showing {previousSlice.length} of {previousIssues.length}
          </span>
        </div>
        {previousIssues.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">No previous issues.</div>
        ) : (
          <>
            <div className="divide-y">
              {previousSlice.map(d => (
                <IssueRow
                  key={`p-${d.id}`}
                  d={d}
                  openNotes={openNotes}
                  setOpenNotes={setOpenNotes}
                  onEdit={editIssue}
                  onToggle={toggleResolved}
                  onDelete={deleteIssue}
                />
              ))}
            </div>
            <Pager page={previousPage} totalPages={prevTotalPages} onPage={setPreviousPage} />
          </>
        )}
      </section>
    </main>
  )
}

function IssueRow({
  d,
  openNotes,
  setOpenNotes,
  onEdit,
  onToggle,
  onDelete,
}: {
  d: any
  openNotes: Record<number, boolean>
  setOpenNotes: React.Dispatch<React.SetStateAction<Record<number, boolean>>>
  onEdit: (d: any) => void
  onToggle: (d: any) => void
  onDelete: (d: any) => void
}) {
  const reported = new Date(d._reported_at)
  const resolvedLabel = d.resolved
    ? (d.resolved_at ? new Date(d.resolved_at).toLocaleString() : 'Resolved')
    : 'Unresolved'

  const notes = (d as any)._notes as Note[] | undefined

  return (
    <div className="p-3 text-sm flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="font-medium">{d.description || '(no description)'}</div>
          <div className="text-xs text-gray-600">
            Reported: {reported.toLocaleString()} • Status: {resolvedLabel}
          </div>
        </div>
        <button className="text-xs underline" onClick={() => onEdit(d)}>Edit</button>
        <button className="text-xs underline" onClick={() => onToggle(d)}>
          {d.resolved ? 'Reopen' : 'Resolve'}
        </button>
        <button className="text-xs underline text-red-600" onClick={() => onDelete(d)}>Delete</button>
      </div>

      {/* Notes toggle (tidy/hidden by default) */}
      {notes && notes.length > 0 && (
        <div>
          <button
            className="text-xs underline"
            onClick={() =>
              setOpenNotes(prev => ({ ...prev, [d.id]: !prev[d.id] }))
            }
          >
            {openNotes[d.id] ? 'Hide notes' : `Show notes (${notes.length})`}
          </button>
          {openNotes[d.id] && (
            <ul className="mt-2 space-y-2">
              {notes.map(n => (
                <li key={n.id} className="border rounded-lg p-2">
                  <div className="text-xs text-gray-600">
                    {n.author?.name || 'Someone'} • {new Date(n.created_at).toLocaleString()}
                  </div>
                  <div>{n.text}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p:number)=>void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between p-3 text-sm">
      <button
        className="border rounded-xl px-3 py-1"
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
      >
        Prev
      </button>
      <div>Page {page} of {totalPages}</div>
      <button
        className="border rounded-xl px-3 py-1"
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
      >
        Next
      </button>
    </div>
  )
}
