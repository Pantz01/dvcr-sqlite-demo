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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setError(null)
      setLoading(true)
      try {
        const [tRes, rRes] = await Promise.all([
          fetch(`${API}/trucks/${truckId}`, { headers: authHeaders() }),
          fetch(`${API}/trucks/${truckId}/reports?limit=100`, { headers: authHeaders() }),
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

  // Build a flat list of unresolved defects from OPEN reports only
  const activeIssues = useMemo(() => {
    const openReports = reports.filter(r => (r.status || '').toUpperCase() === 'OPEN')
    const rows = openReports.flatMap(r =>
      (r.defects || [])
        .filter(d => !d.resolved)
        .map(d => ({ ...d, _created_at: r.created_at }))
    )
    // newest first by the report creation time (fallback stable)
    return rows.sort((a: any, b: any) => +new Date(b._created_at || 0) - +new Date(a._created_at || 0))
  }, [reports])

  async function editIssue(d: Defect) {
    const next = prompt('Edit issue', d.description || '') ?? ''
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ description: next }),
    })
    if (!r.ok) { alert(await r.text()); return }
    // refresh reports to rebuild activeIssues
    const rr = await fetch(`${API}/trucks/${truckId}/reports?limit=100`, { headers: authHeaders() })
    if (rr.ok) setReports(await rr.json())
  }

  async function resolveIssue(d: Defect) {
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ resolved: true }),
    })
    if (!r.ok) { alert(await r.text()); return }
    const rr = await fetch(`${API}/trucks/${truckId}/reports?limit=100`, { headers: authHeaders() })
    if (rr.ok) setReports(await rr.json())
  }

  async function deleteIssue(d: Defect) {
    if (!confirm('Delete this issue?')) return
    const r = await fetch(`${API}/defects/${d.id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    const rr = await fetch(`${API}/trucks/${truckId}/reports?limit=100`, { headers: authHeaders() })
    if (rr.ok) setReports(await rr.json())
  }

  if (loading) return <main className="p-6">Loading…</main>

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">
        {truck ? `Active Issues — Truck ${truck.number}` : 'Active Issues'}
      </h1>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Truck summary (read-only) */}
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

      {/* Active issues only (no Reports box, no report editor) */}
      <section className="border rounded-2xl p-4">
        <div className="font-semibold mb-2">Active Issues</div>
        {activeIssues.length === 0 ? (
          <div className="text-sm text-gray-500">No active (unresolved) issues.</div>
        ) : (
          <div className="divide-y">
            {activeIssues.map((d: any) => (
              <div key={d.id} className="p-3 flex items-center gap-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium">{d.description || '(no description)'}</div>
                  <div className="text-xs text-gray-500">
                    Reported: {d._created_at ? new Date(d._created_at).toLocaleString() : '—'}
                  </div>
                </div>
                <button className="text-xs underline" onClick={() => editIssue(d)}>Edit</button>
                <button className="text-xs underline" onClick={() => resolveIssue(d)}>Resolve</button>
                <button className="text-xs underline text-red-600" onClick={() => deleteIssue(d)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
