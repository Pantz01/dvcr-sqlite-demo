'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
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

type Report = {
  id: number
  created_at: string
  odometer?: number | null
  status: string
  summary?: string | null
  type: 'pre' | 'post'
  driver: { id: number; name: string; email: string; role: string }
  truck: Truck
}

export default function ManageReportsPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <ManageReportsInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function ManageReportsInner() {
  const params = useParams() as { id: string }
  const truckId = Number(params.id)

  const [truck, setTruck] = useState<Truck | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [filter, setFilter] = useState<'all' | 'pre' | 'post'>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // create form
  const [newType, setNewType] = useState<'pre' | 'post'>('pre')
  const [newOdo, setNewOdo] = useState<number>(0)
  const [newSummary, setNewSummary] = useState('')

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
    setReports(await r.json())
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return reports
    return reports.filter(r => r.type === filter)
  }, [reports, filter])

  async function createReport() {
    if (!newOdo || newOdo < 0) {
      if (!confirm('Odometer is 0 — continue?')) return
    }
    setBusy(true)
    const r = await fetch(`${API}/trucks/${truckId}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ type: newType, odometer: newOdo, summary: newSummary }),
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
    setNewSummary('')
    loadReports()
    loadTruck()
  }

  async function saveReport(id: number, patch: Partial<Report>) {
    const r = await fetch(`${API}/reports/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({
        status: patch.status,
        summary: patch.summary,
        odometer: patch.odometer,
      }),
    })
    if (!r.ok) { alert(await r.text()); return }
    const updated = await r.json()
    setReports(prev => prev.map(x => x.id === id ? updated : x))
    if (patch.odometer !== undefined) {
      // refresh truck to reflect higher odometer if updated
      loadTruck()
    }
  }

  async function deleteReport(id: number) {
    if (!confirm('Delete this report? This will also remove its defects, notes, and photos.')) return
    // If your backend is missing DELETE /reports/{id}, add it there.
    const r = await fetch(`${API}/reports/${id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    setReports(prev => prev.filter(x => x.id !== id))
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Manage Reports {truck ? `· ${truck.number}` : ''}</h1>
        <Link href="/admin/trucks" className="underline text-sm">← Back to Trucks</Link>
      </div>

      {/* Create new report */}
      <div className="border rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Add Report</div>
        <div className="grid sm:grid-cols-5 gap-2">
          <select
            className="border p-2 rounded-xl"
            value={newType}
            onChange={(e) => setNewType(e.target.value as 'pre' | 'post')}
          >
            <option value="pre">pre</option>
            <option value="post">post</option>
          </select>

          <input
            type="number"
            className="border p-2 rounded-xl"
            placeholder="Odometer"
            value={newOdo}
            onChange={(e) => setNewOdo(parseInt(e.target.value || '0', 10))}
          />

          <input
            className="border p-2 rounded-xl sm:col-span-2"
            placeholder="Summary (optional)"
            value={newSummary}
            onChange={(e) => setNewSummary(e.target.value)}
          />

          <button
            className="border rounded-xl p-2"
            disabled={busy}
            onClick={createReport}
          >
            {busy ? 'Saving…' : 'Add'}
          </button>
        </div>
        <p className="text-xs text-gray-600">
          Pre/Post trip reports update the truck’s odometer if you enter a higher reading.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">Filter:</span>
        <button
          className={`text-sm px-2 py-1 rounded ${filter==='all' ? 'bg-gray-200' : 'border'}`}
          onClick={() => setFilter('all')}
        >All</button>
        <button
          className={`text-sm px-2 py-1 rounded ${filter==='pre' ? 'bg-gray-200' : 'border'}`}
          onClick={() => setFilter('pre')}
        >Pre</button>
        <button
          className={`text-sm px-2 py-1 rounded ${filter==='post' ? 'bg-gray-200' : 'border'}`}
          onClick={() => setFilter('post')}
        >Post</button>
      </div>

      {/* Reports list */}
      <div className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b">Reports</div>
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No reports.</div>
        ) : (
          <div className="divide-y">
            {filtered.map(r => (
              <ReportRow key={r.id} r={r} onSave={saveReport} onDelete={deleteReport} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function ReportRow({
  r,
  onSave,
  onDelete,
}: {
  r: Report
  onSave: (id: number, patch: Partial<Report>) => void
  onDelete: (id: number) => void
}) {
  const [status, setStatus] = useState(r.status)
  const [summary, setSummary] = useState(r.summary || '')
  const [odo, setOdo] = useState<number>(r.odometer ?? 0)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    await onSave(r.id, { status, summary, odometer: odo })
    setSaving(false)
  }

  return (
    <div className="p-3 grid md:grid-cols-6 gap-3 items-center">
      <div className="text-xs uppercase">{r.type}</div>
      <div className="text-sm">{new Date(r.created_at).toLocaleString()}</div>

      <div>
        <label className="text-xs text-gray-600">Status</label>
        <select
          className="border p-2 rounded-xl w-full"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="OPEN">OPEN</option>
          <option value="CLOSED">CLOSED</option>
        </select>
      </div>

      <div>
        <label className="text-xs text-gray-600">Odometer</label>
        <input
          type="number"
          className="border p-2 rounded-xl w-full"
          value={odo}
          onChange={(e) => setOdo(parseInt(e.target.value || '0', 10))}
        />
      </div>

      <div className="md:col-span-2">
        <label className="text-xs text-gray-600">Summary</label>
        <input
          className="border p-2 rounded-xl w-full"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>

      <div className="md:col-span-6 flex items-center gap-3 pt-1">
        <button
          className="border rounded-xl px-3 py-1"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        <button
          className="text-red-600 underline text-sm"
          onClick={() => onDelete(r.id)}
        >
          Delete
        </button>

        <div className="text-xs text-gray-600 ml-auto">
          Driver: {r.driver?.name ?? '—'}
        </div>
      </div>
    </div>
  )
}
