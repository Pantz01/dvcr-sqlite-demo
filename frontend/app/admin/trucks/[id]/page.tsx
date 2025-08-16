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
  status: string
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

  // add/edit issue form
  const [newIssue, setNewIssue] = useState('')

  useEffect(() => {
    loadTruck()
    loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckId])

  async function loadTruck() {
    const r = await fetch(`${API}/trucks/${truckId}`, { headers: authHeaders() })
    if (r.ok) setTruck(await r.json())
  }

  async function loadReports() {
    setLoading(true)
    const r = await fetch(`${API}/trucks/${truckId}/reports`, { headers: authHeaders() })
    setLoading(false)
    if (!r.ok) { alert(await r.text()); return }
    const list: Report[] = await r.json()
    setReports(list)
    if (list.length) {
      // hydrate the newest report
      const rr = await fetch(`${API}/reports/${list[0].id}`, { headers: authHeaders() })
      setActiveReport(rr.ok ? await rr.json() : list[0])
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

  // Create a new report (no pre/post, just odometer + summary optional)
  async function createReport(odometer: number, summary: string) {
    if (!truck) return
    setBusy(true)
    const r = await fetch(`${API}/trucks/${truck.id}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ odometer, summary }), // backend defaults type to "pre", but we ignore it
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
    await loadTruck()
    await loadReports()
  }

  // Update report fields
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

  // Delete report
  async function deleteReport() {
    if (!activeReport) return
    if (!confirm('Delete this report and all its issues/notes?')) return
    const r = await fetch(`${API}/reports/${activeReport.id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    await loadReports()
  }

  // Issues (defects) CRUD (we store everything as component: 'general', severity: 'minor')
  async function addIssue() {
    if (!activeReport) return
    const text = newIssue.trim()
    if (!text) return
    const r = await fetch(`${API}/reports/${activeReport.id}/defects`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ component: 'general', severity: 'minor', description: text }),
    })
    if (!r.ok) { alert(await r.text()); return }
    setNewIssue('')
    await reloadActiveReport()
  }

  async function editIssue(d: Defect) {
    const next = prompt('Edit issue:', d.description || '') ?? ''
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ description: next }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadActiveReport()
  }

  async function toggleIssueResolved(d: Defect) {
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

  // Simple inline creator for new report
  const [newOdo, setNewOdo] = useState<number>(0)
  const [newSummary, setNewSummary] = useState('')

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">{truck ? `Truck ${truck.number}` : 'Truck'}</h1>

      {/* Truck basics */}
      <div className="border rounded-2xl p-4 text-sm">
        {truck ? (
          <div className="grid sm:grid-cols-4 gap-2">
            <div><span className="text-gray-600">Number:</span> <b>{truck.number}</b></div>
            <div><span className="text-gray-600">VIN:</span> <b>{truck.vin || '—'}</b></div>
            <div><span className="text-gray-600">Odometer:</span> <b>{truck.odometer ?? 0}</b></div>
            <div><span className="text-gray-600">Status:</span> <b>{truck.active ? 'Active' : 'Inactive'}</b></div>
          </div>
        ) : (
          <div className="text-gray-500">Loading truck…</div>
        )}
      </div>

      {/* Create a report (just odometer + summary) */}
      <div className="border rounded-2xl p-4 space-y-2">
        <div className="font-semibold">New Report</div>
        <div className="grid sm:grid-cols-5 gap-2">
          <input
            type="number"
            className="border p-2 rounded-xl"
            placeholder="Odometer"
            value={newOdo}
            onChange={(e) => setNewOdo(parseInt(e.target.value || '0', 10))}
          />
          <input
            className="border p-2 rounded-xl sm:col-span-3"
            placeholder="Summary (optional)"
            value={newSummary}
            onChange={(e) => setNewSummary(e.target.value)}
          />
          <button
            className="border rounded-xl p-2"
            disabled={busy}
            onClick={() => createReport(newOdo, newSummary)}
          >
            {busy ? 'Creating…' : 'Create report'}
          </button>
        </div>
      </div>

      {/* Active report details */}
      <div className="border rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Report Details</div>
        {!activeReport ? (
          <div className="text-sm text-gray-500">No reports yet. Create the first one above.</div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-3 items-end">
              <div className="text-sm text-gray-700">
                Created <b>{new Date(activeReport.created_at).toLocaleString()}</b> · Status <b>{activeReport.status}</b>
                <div className="mt-2 flex gap-2 items-center">
                  <span className="text-gray-600 text-xs">Odometer:</span>
                  <input
                    type="number"
                    defaultValue={activeReport.odometer ?? 0}
                    className="border rounded px-2 py-0.5 w-32"
                    onBlur={(e) => updateReportField({ odometer: parseInt(e.target.value || '0', 10) })}
                  />
                </div>
                <div className="mt-2">
                  <input
                    className="border rounded px-2 py-1 w-full"
                    placeholder="Summary"
                    defaultValue={activeReport.summary ?? ''}
                    onBlur={(e) => updateReportField({ summary: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2 md:justify-end">
                {activeReport.status !== 'CLOSED' && (
                  <button className="border rounded-xl px-3 py-2" onClick={() => updateReportField({ status: 'CLOSED' })}>
                    Close report
                  </button>
                )}
                <button className="border border-red-600 text-red-600 rounded-xl px-3 py-2" onClick={deleteReport}>
                  Delete report
                </button>
              </div>
            </div>

            {/* Issues (defects) */}
            <div className="rounded-xl border">
              <div className="p-3 font-semibold">Issues</div>

              <div className="p-3 grid sm:grid-cols-5 gap-2 border-b">
                <input
                  className="border p-2 rounded-xl sm:col-span-4"
                  placeholder="Describe a new issue"
                  value={newIssue}
                  onChange={(e) => setNewIssue(e.target.value)}
                />
                <button className="border rounded-xl p-2" onClick={addIssue}>Add</button>
              </div>

              {defects.length === 0 ? (
                <div className="p-3 text-sm text-gray-500">No issues listed.</div>
              ) : (
                <div className="divide-y">
                  {defects.map(d => (
                    <div key={d.id} className="p-3 text-sm flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={d.resolved}
                        onChange={() => toggleIssueResolved(d)}
                        title={d.resolved ? 'Unresolve' : 'Resolve'}
                      />
                      <div className="flex-1">
                        <div className={`font-medium ${d.resolved ? 'line-through text-gray-500' : ''}`}>
                          {d.description || '(no description)'}
                        </div>
                        <div className="text-xs text-gray-600">
                          {d.resolved ? 'Resolved' : 'Open'}
                        </div>
                      </div>
                      <button className="text-xs underline" onClick={() => editIssue(d)}>Edit</button>
                      <button className="text-xs underline text-red-600" onClick={() => deleteIssue(d)}>Delete</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* All reports list (select to view/edit) */}
      <div className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b">All Reports</div>
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No reports yet.</div>
        ) : (
          <div className="divide-y">
            {reports.map(r => (
              <button
                key={r.id}
                className={`w-full text-left p-3 hover:bg-gray-50 ${activeReport?.id === r.id ? 'bg-gray-50' : ''}`}
                onClick={async () => {
                  const rr = await fetch(`${API}/reports/${r.id}`, { headers: authHeaders() })
                  setActiveReport(rr.ok ? await rr.json() : r)
                }}
              >
                <div className="text-sm">
                  {new Date(r.created_at).toLocaleString()} · Odo {r.odometer ?? '—'} · {r.status}
                </div>
                {r.summary ? <div className="text-xs text-gray-600">{r.summary}</div> : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
