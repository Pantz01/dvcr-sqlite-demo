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

export default function TruckPage() {
  return (
    <RequireAuth>
      <TruckInner />
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
  const [error, setError] = useState<string | null>(null)

  // compact add-issue state
  const [newIssue, setNewIssue] = useState('')

  // compact add-service state (manager+ only)
  const [svcType, setSvcType] = useState<'oil' | 'chassis'>('oil')
  const [svcOdo, setSvcOdo] = useState<number | ''>('')
  const [svcNotes, setSvcNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setError(null)
    setLoading(true)
    ;(async () => {
      try {
        const t = await fetch(`${API}/trucks/${truckId}`, { headers: authHeaders() })
        if (!t.ok) throw new Error(await t.text())
        setTruck(await t.json())

        const r = await fetch(`${API}/trucks/${truckId}/reports?limit=200`, { headers: authHeaders() })
        if (!r.ok) throw new Error(await r.text())
        const list: Report[] = await r.json()
        setReports(list)

        // pick most recent report as “active” (same as before, but compact)
        if (list.length) {
          const first = await fetch(`${API}/reports/${list[0].id}`, { headers: authHeaders() })
          setActiveReport(first.ok ? await first.json() : list[0])
        } else {
          setActiveReport(null)
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
  }, [truckId])

  async function reloadActiveReport() {
    if (!activeReport) return
    const rr = await fetch(`${API}/reports/${activeReport.id}`, { headers: authHeaders() })
    if (rr.ok) {
      const full = await rr.json()
      setActiveReport(full)
      setReports(prev => prev.map(x => (x.id === full.id ? full : x)))
    }
  }

  // ===== Issues (compact) =====
  const defects = useMemo(() => activeReport?.defects || [], [activeReport])

  async function addIssue() {
    if (!activeReport) return
    const text = newIssue.trim()
    if (!text) return
    setBusy(true)
    const r = await fetch(`${API}/reports/${activeReport.id}/defects`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        component: 'general',
        severity: 'minor',
        description: text,
      }),
    })
    setBusy(false)
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

  // ===== Service (manager+ only, compact UI) =====
  async function addService() {
    if (!truck) return
    const odometer = typeof svcOdo === 'number' ? svcOdo : parseInt(String(svcOdo || '0'), 10)
    if (!odometer || odometer < 0) { alert('Enter odometer'); return }
    setBusy(true)
    const r = await fetch(`${API}/trucks/${truck.id}/service`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ service_type: svcType, odometer, notes: svcNotes.trim() || null }),
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
    setSvcNotes(''); setSvcOdo(''); setSvcType('oil')
    alert('Service added')
  }

  if (loading) return <main className="p-4 text-sm">Loading…</main>

  return (
    <main className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {truck ? `Truck ${truck.number}` : 'Truck'}
        </h1>
        <div className="text-xs text-gray-500">
          {truck ? <>VIN {truck.vin || '—'} · Odo {truck.odometer ?? 0} · {truck.active ? 'Active' : 'Inactive'}</> : '—'}
        </div>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      {/* Active report issues (compact) */}
      <section className="border rounded-xl">
        <div className="p-2 font-medium border-b text-sm">Active Issues</div>

        {!activeReport ? (
          <div className="p-3 text-xs text-gray-500">No report selected.</div>
        ) : (
          <div className="p-2 space-y-2">
            {/* Add Issue — compact row */}
            <div className="flex items-center gap-2 max-w-2xl">
              <input
                className="border rounded-lg px-2 py-1 text-sm flex-1"
                placeholder="Add an issue (e.g., brake light out)"
                value={newIssue}
                onChange={(e) => setNewIssue(e.target.value)}
              />
              <button
                className="border rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                onClick={addIssue}
                disabled={busy || !newIssue.trim()}
              >
                Add
              </button>
            </div>

            {/* Issues list — compact rows */}
            <div className="rounded-lg border divide-y">
              {defects.length === 0 ? (
                <div className="p-2 text-xs text-gray-500">No issues on this report.</div>
              ) : defects.map(d => (
                <div key={d.id} className="p-2 flex items-center gap-2 text-sm">
                  <div className="flex-1">
                    <div className="font-medium truncate">
                      {d.description || '(no description)'}
                    </div>
                    <div className="text-[11px] text-gray-600">
                      {d.resolved ? 'Resolved' : 'Open'}
                      {d.resolved && d.resolved_at ? ` • ${new Date(d.resolved_at).toLocaleDateString()}` : null}
                    </div>
                  </div>
                  <button className="text-[11px] underline" onClick={() => editIssue(d)}>Edit</button>
                  <button className="text-[11px] underline" onClick={() => toggleResolved(d)}>
                    {d.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                  <button className="text-[11px] underline text-red-600" onClick={() => deleteIssue(d)}>Delete</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Add Service — visible only to manager/admin; compact controls */}
      <RoleGuard roles={['manager', 'admin']}>
        <section className="border rounded-xl">
          <div className="p-2 font-medium border-b text-sm">Add Service</div>
          <div className="p-2 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 max-w-3xl items-center">
              <select
                className="border rounded-lg px-2 py-1 text-sm"
                value={svcType}
                onChange={(e) => setSvcType(e.target.value as 'oil' | 'chassis')}
              >
                <option value="oil">oil</option>
                <option value="chassis">chassis</option>
              </select>

              <input
                type="number"
                className="border rounded-lg px-2 py-1 text-sm"
                placeholder="Odometer"
                value={svcOdo}
                onChange={(e) => setSvcOdo(e.target.value === '' ? '' : parseInt(e.target.value || '0', 10))}
              />

              <input
                className="border rounded-lg px-2 py-1 text-sm sm:col-span-2"
                placeholder="Notes (optional)"
                value={svcNotes}
                onChange={(e) => setSvcNotes(e.target.value)}
              />

              <button
                className="border rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                onClick={addService}
                disabled={busy || !truck}
              >
                {busy ? 'Saving…' : 'Add'}
              </button>
            </div>

            <p className="text-[11px] text-gray-600">
              Tip: To change “next due”, add a service at the odometer where the last service happened.
            </p>
          </div>
        </section>
      </RoleGuard>
    </main>
  )
}
