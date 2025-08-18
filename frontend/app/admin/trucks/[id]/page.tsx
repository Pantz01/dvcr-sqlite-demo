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

type Defect = {
  id: number
  component: string
  severity: string
  description?: string | null
  resolved: boolean
  resolved_at?: string | null
}

type Report = {
  id: number
  created_at: string
  odometer?: number | null
  status: 'OPEN' | 'CLOSED' | string
  summary?: string | null
  defects?: Defect[]
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

  // pagination
  const PAGE_SIZE = 25
  const [activePage, setActivePage] = useState(1)
  const [prevPage, setPrevPage] = useState(1)

  useEffect(() => {
    (async () => {
      setError(null)
      setLoading(true)
      try {
        const [tRes, rRes] = await Promise.all([
          fetch(`${API}/trucks/${truckId}`, { headers: authHeaders() }),
          // pull a big page; backend already sorts newest first
          fetch(`${API}/trucks/${truckId}/reports?limit=1000`, { headers: authHeaders() }),
        ])
        if (!tRes.ok) setError(await tRes.text())
        else setTruck(await tRes.json())

        if (!rRes.ok) setError(await rRes.text())
        else setReports(await rRes.json())
      } catch (e: any) {
        setError(e?.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
  }, [truckId])

  // Flatten ALL issues across ALL reports, annotate with report metadata
  type FlatIssue = Defect & { _reported_at: string; _report_id: number }
  const allIssues: FlatIssue[] = useMemo(() => {
    const rows = reports.flatMap(r =>
      (r.defects || []).map(d => ({
        ...d,
        _reported_at: r.created_at,
        _report_id: r.id,
      }))
    )
    // newest first
    return rows.sort((a, b) => +new Date(b._reported_at) - +new Date(a._reported_at))
  }, [reports])

  const activeIssues = useMemo(
    () => allIssues.filter(d => !d.resolved),
    [allIssues]
  )
  const previousIssues = useMemo(
    () => allIssues.filter(d => d.resolved),
    [allIssues]
  )

  // Active pagination
  const activeTotalPages = Math.max(1, Math.ceil(activeIssues.length / PAGE_SIZE))
  const activeSafePage = Math.min(Math.max(1, activePage), activeTotalPages)
  const activeSlice = useMemo(() => {
    const start = (activeSafePage - 1) * PAGE_SIZE
    return activeIssues.slice(start, start + PAGE_SIZE)
  }, [activeIssues, activeSafePage])

  // Previous pagination
  const prevTotalPages = Math.max(1, Math.ceil(previousIssues.length / PAGE_SIZE))
  const prevSafePage = Math.min(Math.max(1, prevPage), prevTotalPages)
  const prevSlice = useMemo(() => {
    const start = (prevSafePage - 1) * PAGE_SIZE
    return previousIssues.slice(start, start + PAGE_SIZE)
  }, [previousIssues, prevSafePage])

  // Refresh reports after a mutation
  async function refreshReports() {
    const rr = await fetch(`${API}/trucks/${truckId}/reports?limit=1000`, { headers: authHeaders() })
    if (rr.ok) {
      const data = await rr.json()
      setReports(data)
      // keep pages valid if counts shrank
      const actPages = Math.max(1, Math.ceil(
        data.flatMap((r: Report) => (r.defects || []).filter(d => !d.resolved)).length / PAGE_SIZE
      ))
      if (activeSafePage > actPages) setActivePage(actPages)

      const prPages = Math.max(1, Math.ceil(
        data.flatMap((r: Report) => (r.defects || []).filter(d => d.resolved)).length / PAGE_SIZE
      ))
      if (prevSafePage > prPages) setPrevPage(prPages)
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
    await refreshReports()
  }

  async function resolveIssue(d: Defect) {
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ resolved: true }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await refreshReports()
  }

  async function reopenIssue(d: Defect) {
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ resolved: false }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await refreshReports()
  }

  async function deleteIssue(d: Defect) {
    if (!confirm('Delete this issue?')) return
    const r = await fetch(`${API}/defects/${d.id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    await refreshReports()
  }

  // Export CSV of ALL issues (active + previous) for this truck
  function exportAllIssuesCsv() {
    const rows = allIssues.map(d => ({
      ReportID: d._report_id,
      ReportedAt: new Date(d._reported_at).toISOString(),
      TruckNumber: truck?.number ?? '',
      Description: d.description ?? '',
      Component: d.component ?? '',
      Severity: d.severity ?? '',
      Resolved: d.resolved ? 'Yes' : 'No',
      ResolvedAt: d.resolved_at ? new Date(d.resolved_at).toISOString() : '',
    }))

    const headers = Object.keys(rows[0] || {
      ReportID: '', ReportedAt: '', TruckNumber: '', Description: '',
      Component: '', Severity: '', Resolved: '', ResolvedAt: ''
    })

    const escapeCell = (v: any) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }

    const lines: string[] = []
    lines.push(headers.join(','))
    for (const row of rows) lines.push(headers.map(h => escapeCell((row as any)[h])).join(','))

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {truck ? `Issues — Truck ${truck.number}` : 'Issues'}
        </h1>
        <button
          onClick={exportAllIssuesCsv}
          className="border rounded-xl px-3 py-1.5 text-sm"
          title="Export all issues for this truck (CSV for Excel)"
        >
          Export CSV
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Truck summary */}
      <div className="border rounded-2xl p-4 text-sm">
        {truck ? (
          <div className="grid sm:grid-cols-4 gap-2">
            <div><span className="text-gray-600">Truck #</span> <b>{truck.number}</b></div>
            <div><span className="text-gray-600">VIN</span> <b>{truck.vin || '—'}</b></div>
            <div><span className="text-gray-600">Odometer</span> <b>{truck.odometer?.toLocaleString?.() ?? truck.odometer}</b></div>
            <div><span className="text-gray-600">Status</span> <b>{truck.active ? 'Active' : 'Inactive'}</b></div>
          </div>
        ) : (
          <div className="text-gray-500">Truck not found.</div>
        )}
      </div>

      {/* Active issues (unresolved) */}
      <section className="border rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Active Issues</div>
          <div className="text-xs text-gray-500">
            Showing {activeIssues.length === 0 ? 0 : ( (activeSafePage - 1) * PAGE_SIZE + 1 )}
            –
            {Math.min(activeSafePage * PAGE_SIZE, activeIssues.length)} of {activeIssues.length}
          </div>
        </div>

        {activeIssues.length === 0 ? (
          <div className="text-sm text-gray-500">No active (unresolved) issues.</div>
        ) : (
          <>
            <div className="divide-y">
              {activeSlice.map((d) => (
                <div key={d.id} className="p-3 flex items-center gap-3 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{d.description || '(no description)'}</div>
                    <div className="text-xs text-gray-500">Reported: {new Date(d._reported_at).toLocaleString()}</div>
                  </div>
                  <button className="text-xs underline" onClick={() => editIssue(d)}>Edit</button>
                  <button className="text-xs underline" onClick={() => resolveIssue(d)}>Resolve</button>
                  <button className="text-xs underline text-red-600" onClick={() => deleteIssue(d)}>Delete</button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-3">
              <button
                className="border rounded-xl px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={activeSafePage <= 1}
                onClick={() => setActivePage(p => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <div className="text-xs text-gray-600">Page {activeSafePage} of {activeTotalPages}</div>
              <button
                className="border rounded-xl px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={activeSafePage >= activeTotalPages}
                onClick={() => setActivePage(p => Math.min(activeTotalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </section>

      {/* Previous issues (resolved) */}
      <section className="border rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Previous Issues</div>
          <div className="text-xs text-gray-500">
            Showing {previousIssues.length === 0 ? 0 : ( (prevSafePage - 1) * PAGE_SIZE + 1 )}
            –
            {Math.min(prevSafePage * PAGE_SIZE, previousIssues.length)} of {previousIssues.length}
          </div>
        </div>

        {previousIssues.length === 0 ? (
          <div className="text-sm text-gray-500">No resolved issues yet.</div>
        ) : (
          <>
            <div className="divide-y">
              {prevSlice.map((d) => (
                <div key={d.id} className="p-3 flex items-center gap-3 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{d.description || '(no description)'}</div>
                    <div className="text-xs text-gray-500">
                      Reported: {new Date(d._reported_at).toLocaleString()}
                      {d.resolved_at ? ` • Resolved: ${new Date(d.resolved_at).toLocaleString()}` : ''}
                    </div>
                  </div>
                  <button className="text-xs underline" onClick={() => editIssue(d)}>Edit</button>
                  <button className="text-xs underline" onClick={() => reopenIssue(d)}>Reopen</button>
                  <button className="text-xs underline text-red-600" onClick={() => deleteIssue(d)}>Delete</button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-3">
              <button
                className="border rounded-xl px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={prevSafePage <= 1}
                onClick={() => setPrevPage(p => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <div className="text-xs text-gray-600">Page {prevSafePage} of {prevTotalPages}</div>
              <button
                className="border rounded-xl px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={prevSafePage >= prevTotalPages}
                onClick={() => setPrevPage(p => Math.min(prevTotalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
