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
}

type Report = {
  id: number
  created_at: string
  odometer?: number | null
  status: 'OPEN' | 'CLOSED' | string
  summary?: string | null
  defects?: Defect[]
  notes?: { id: number; text: string; created_at: string; author: { name: string } }[]
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
  const [activeReport, setActiveReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // add-issue form
  const [newIssue, setNewIssue] = useState('')

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
    const r = await fetch(`${API}/trucks/${truckId}/reports`, { headers: authHeaders() })
    setLoading(false)
    if (!r.ok) { setError(await r.text()); return }
    const list: Report[] = await r.json()
    setReports(list)
    if (list.length) {
      const first = await fetch(`${API}/reports/${list[0].id}`, { headers: authHeaders() })
      if (first.ok) setActiveReport(await first.json())
      else setActiveReport(list[0])
    } else {
      setActiveReport(null)
    }
  }

  async function reloadActiveReport() {
    if (!activeReport) return
    const rr = await fetch(`${API}/reports/${activeReport.id}`, { headers: authHeaders() })
    if (rr.ok) {
      const full = await rr.json()
      setActiveReport(full)
      setReports(prev => prev.map(x => x.id === full.id ? full : x))
    }
  }

  // Report field edits
  async function updateReportField(patch: Partial<Pick<Report, 'odometer' | 'summary' | 'status'>>) {
    if (!activeReport) return
    const r = await fetch(`${API}/reports/${activeReport.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(patch),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadActiveReport()
  }

  // Delete whole report
  async function deleteReport(rep: Report) {
    if (!confirm('Delete this report and all its issues?')) return
    const r = await fetch(`${API}/reports/${rep.id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    await loadReports()
  }

  // Add/edit/resolve/delete issues
  async function addIssue() {
    if (!activeReport) return
    const text = newIssue.trim()
    if (!text) return
    const r = await fetch(`${API}/reports/${activeReport.id}/defects`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        component: 'general',
        severity: 'minor',
        description: text,
      }),
    })
    if (!r.ok) { alert(await r.text()); return }
    setNewIssue('')
    await reloadActiveReport()
  }

  async function editIssue(d: Defect) {
    const next = prompt('Edit issue', d.description || '') ?? ''
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ description: next }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadActiveReport()
  }

  async function toggleResolved(d: Defect) {
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ resolved: !d.resolved }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadActiveReport()
  }

  async function deleteIssue(d: Defect) {
    if (!confirm('Delete this issue?')) return
    const r = await fetch(`${API}/defects/${d.id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    await reloadActiveReport()
  }

  const defects = useMemo(() => activeReport?.defects || [], [activeReport])

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">
        {truck ? `Truck ${truck.number}` : 'Truck'}
      </h1>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Truck details (read-only here; truck editing happens in Admin Trucks list page) */}
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

      {/* Reports list + pick one */}
      <div className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b">Reports</div>
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No reports yet.</div>
        ) : (
          <div className="divide-y">
            {reports.map(r => (
              <div key={r.id} className={`p-3 ${activeReport?.id === r.id ? 'bg-gray-50' : ''}`}>
                <div className="flex items-center gap-3 justify-between">
                  <button
                    className="text-left flex-1 hover:underline"
                    onClick={async () => {
                      const rr = await fetch(`${API}/reports/${r.id}`, { headers: authHeaders() })
                      if (rr.ok) setActiveReport(await rr.json())
                      else setActiveReport(r)
                    }}
                  >
                    <div className="text-sm">
                      {new Date(r.created_at).toLocaleString()} · Odo {r.odometer ?? '—'} · {r.status}
                    </div>
                    {r.summary ? <div className="text-xs text-gray-600">{r.summary}</div> : null}
                  </button>
                  <button
                    className="text-xs underline text-red-600"
                    onClick={() => deleteReport(r)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active report editor */}
      <div className="border rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Active Report</div>
        {!activeReport ? (
          <div className="text-sm text-gray-500">Select a report above.</div>
        ) : (
          <>
            <div className="grid md:grid-cols-3 gap-3 items-end">
              <label className="grid gap-1 text-sm">
                <span className="text-gray-600">Odometer</span>
                <input
                  type="number"
                  defaultValue={activeReport.odometer ?? 0}
                  className="border p-2 rounded-xl"
                  onBlur={(e) => updateReportField({ odometer: parseInt(e.target.value || '0', 10) })}
                />
              </label>

              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="text-gray-600">Summary</span>
                <input
                  defaultValue={activeReport.summary ?? ''}
                  className="border p-2 rounded-xl w-full"
                  onBlur={(e) => updateReportField({ summary: e.target.value })}
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-gray-600">Status</span>
                <select
                  defaultValue={activeReport.status}
                  className="border p-2 rounded-xl"
                  onChange={(e) => updateReportField({ status: e.target.value as 'OPEN' | 'CLOSED' })}
                >
                  <option value="OPEN">OPEN</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </label>
            </div>

            {/* Add issue */}
            <div className="grid sm:grid-cols-5 gap-2">
              <input
                className="border p-2 rounded-xl sm:col-span-4"
                placeholder="Add an issue (e.g., brake light out)"
                value={newIssue}
                onChange={(e) => setNewIssue(e.target.value)}
              />
              <button className="border rounded-xl p-2" disabled={busy} onClick={addIssue}>
                Add issue
              </button>
            </div>

            {/* Issues list */}
            <div className="rounded-xl border divide-y">
              <div className="p-3 font-semibold">Issues</div>
              {(defects.length === 0) && (
                <div className="p-3 text-sm text-gray-500">No issues on this report.</div>
              )}
              {defects.map(d => (
                <div key={d.id} className="p-3 flex items-center gap-3 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">
                      {d.description || '(no description)'}
                    </div>
                    <div className="text-xs text-gray-600">
                      {d.resolved ? 'Resolved' : 'Open'}
                    </div>
                  </div>
                  <button className="text-xs underline" onClick={() => editIssue(d)}>Edit</button>
                  <button className="text-xs underline" onClick={() => toggleResolved(d)}>
                    {d.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                  <button className="text-xs underline text-red-600" onClick={() => deleteIssue(d)}>Delete</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
