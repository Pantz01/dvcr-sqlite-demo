'use client'

import { useEffect, useMemo, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'
import { useParams } from 'next/navigation'

type Truck = {
  id: number
  number: string
  vin?: string
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
}

type PM = {
  odometer: number
  oil_next_due: number
  oil_miles_remaining: number
  chassis_next_due: number
  chassis_miles_remaining: number
}

export default function AdminTruckDetailPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager','admin']}>
        <Inner />
      </RoleGuard>
    </RequireAuth>
  )
}

function Inner() {
  const { id } = useParams() as { id: string }
  const [truck, setTruck] = useState<Truck | null>(null)
  const [pm, setPm] = useState<PM | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [total, setTotal] = useState(0)
  const [filterType, setFilterType] = useState<'all'|'pre'|'post'>('all')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<number|null>(null)

  useEffect(() => {
    loadTruck()
  }, [id])

  useEffect(() => {
    loadReports()
  }, [id, filterType, page, size])

  async function loadTruck() {
    const [t, p] = await Promise.all([
      fetch(`${API}/trucks/${id}`, { headers: authHeaders() }).then(r=>r.json()),
      fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() }).then(r=>r.json()),
    ])
    setTruck(t); setPm(p)
  }

  async function loadReports() {
    setLoading(true)
    const params = new URLSearchParams({
      skip: String((page-1)*size),
      limit: String(size),
    })
    if (filterType !== 'all') params.set('type', filterType)
    const r = await fetch(`${API}/trucks/${id}/reports?`+params.toString(), { headers: authHeaders() })
    setLoading(false)
    if (!r.ok) { alert(await r.text()); return }
    const totalHeader = r.headers.get('X-Total-Count')
    setTotal(totalHeader ? parseInt(totalHeader, 10) : 0)
    setReports(await r.json())
  }

  async function saveReport(reportId: number, partial: Partial<Report>) {
    const body: any = {}
    if (partial.status !== undefined) body.status = partial.status
    if (partial.summary !== undefined) body.summary = partial.summary
    if (partial.odometer !== undefined && partial.odometer !== null) body.odometer = Number(partial.odometer)
    if (partial.type !== undefined) body.type = partial.type
    const r = await fetch(`${API}/reports/${reportId}`, { method:'PATCH', headers: jsonHeaders(), body: JSON.stringify(body) })
    if (!r.ok) { alert(await r.text()); return }
    setEditingId(null)
    loadTruck()      // PM can change if odometer changes
    loadReports()
  }

  async function deleteReport(reportId: number) {
    if (!confirm('Delete this report?')) return
    const r = await fetch(`${API}/reports/${reportId}`, { method:'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    // Adjust page if last row on page was removed
    if (reports.length === 1 && page > 1) setPage(p => p-1)
    else loadReports()
  }

  const pages = Math.max(1, Math.ceil(total / size))
  const start = total === 0 ? 0 : (page-1)*size + 1
  const end = Math.min(total, page*size)

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">Trucks · Admin</h1>
        <a className="text-sm underline" href="/admin/trucks">Back to list</a>
      </div>

      {truck && (
        <div className="border rounded-2xl p-4 space-y-2">
          <div className="text-lg font-semibold">Truck {truck.number}</div>
          <div className="text-sm text-gray-700">VIN: {truck.vin || '—'}</div>
          <div className="text-sm text-gray-700">Active: {truck.active ? 'Yes' : 'No'}</div>
          <div className="text-sm text-gray-700">Odometer: {truck.odometer.toLocaleString()}</div>
        </div>
      )}

      {pm && (
        <div className="border rounded-2xl p-4 grid sm:grid-cols-4 gap-3 text-sm">
          <div><span className="font-semibold">Odometer:</span> {pm.odometer.toLocaleString()}</div>
          <div><span className="font-semibold">Oil next due:</span> {pm.oil_next_due.toLocaleString()} ({pm.oil_miles_remaining.toLocaleString()} mi left)</div>
          <div><span className="font-semibold">Chassis next due:</span> {pm.chassis_next_due.toLocaleString()} ({pm.chassis_miles_remaining.toLocaleString()} mi left)</div>
        </div>
      )}

      {/* Reports */}
      <div className="border rounded-2xl overflow-hidden">
        <div className="p-2 border-b flex items-center gap-3">
          <div className="font-semibold">Reports</div>
          <select className="border rounded-lg p-1 text-sm" value={filterType} onChange={e=>{ setPage(1); setFilterType(e.target.value as any) }}>
            <option value="all">All</option>
            <option value="pre">Pre-trip</option>
            <option value="post">Post-trip</option>
          </select>
          <div className="flex-1" />
          <div className="text-sm text-gray-600">{loading ? 'Loading…' : (total ? `${start}-${end} of ${total}` : 'No reports')}</div>
          <label className="text-sm flex items-center gap-2">
            Page size
            <select className="border p-1 rounded-lg" value={size} onChange={e=>{ setPage(1); setSize(parseInt(e.target.value,10)) }}>
              {[10,25,50].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button className="border rounded-lg px-2 py-1 text-sm" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Prev</button>
            <span className="px-2 text-sm">Page {page} / {pages}</span>
            <button className="border rounded-lg px-2 py-1 text-sm" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>Next</button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-gray-200 text-sm font-semibold">
          <div className="bg-white p-2">Date</div>
          <div className="bg-white p-2">Type</div>
          <div className="bg-white p-2">Odometer</div>
          <div className="bg-white p-2">Driver</div>
          <div className="bg-white p-2">Status</div>
          <div className="bg-white p-2">Summary</div>
          <div className="bg-white p-2">Actions</div>

          {reports.map(r => (
            <ReportRow
              key={r.id}
              r={r}
              editing={editingId===r.id}
              onEdit={()=>setEditingId(r.id)}
              onCancel={()=>setEditingId(null)}
              onSave={(p)=>saveReport(r.id, p)}
              onDelete={()=>deleteReport(r.id)}
            />
          ))}
        </div>
      </div>
    </main>
  )
}

function ReportRow({
  r, editing, onEdit, onCancel, onSave, onDelete
}: {
  r: Report
  editing: boolean
  onEdit: ()=>void
  onCancel: ()=>void
  onSave: (p: Partial<Report>)=>void
  onDelete: ()=>void
}) {
  const [type, setType] = useState<'pre'|'post'>(r.type)
  const [odometer, setOdometer] = useState<string>(r.odometer?.toString() ?? '')
  const [status, setStatus] = useState(r.status)
  const [summary, setSummary] = useState(r.summary ?? '')

  useEffect(() => {
    if (editing) {
      setType(r.type)
      setOdometer(r.odometer?.toString() ?? '')
      setStatus(r.status)
      setSummary(r.summary ?? '')
    }
  }, [editing, r])

  const date = new Date(r.created_at).toLocaleString()

  return (
    <>
      <div className="bg-white p-2">{date}</div>
      <div className="bg-white p-2">
        {editing ? (
          <select className="border p-1 rounded-lg" value={type} onChange={e=>setType(e.target.value as 'pre'|'post')}>
            <option value="pre">pre</option>
            <option value="post">post</option>
          </select>
        ) : r.type}
      </div>
      <div className="bg-white p-2">
        {editing ? (
          <input className="border p-1 rounded-lg w-28" value={odometer} onChange={e=>setOdometer(e.target.value)} />
        ) : (r.odometer ?? '—')}
      </div>
      <div className="bg-white p-2">{r.driver?.name || '—'}</div>
      <div className="bg-white p-2">
        {editing ? (
          <select className="border p-1 rounded-lg" value={status} onChange={e=>setStatus(e.target.value)}>
            {['OPEN','IN_PROGRESS','CLOSED'].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        ) : r.status}
      </div>
      <div className="bg-white p-2">
        {editing ? (
          <input className="border p-1 rounded-lg w-full" value={summary} onChange={e=>setSummary(e.target.value)} />
        ) : (r.summary || '—')}
      </div>
      <div className="bg-white p-2">
        {editing ? (
          <div className="flex gap-2">
            <button className="border rounded-lg px-2" onClick={()=>onSave({
              type,
              status,
              summary,
              odometer: odometer === '' ? null : Number(odometer),
            })}>Save</button>
            <button className="text-gray-600 underline" onClick={onCancel}>Cancel</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <a className="underline" href={`/reports/${r.id}`}>Open</a>
            <button className="border rounded-lg px-2" onClick={onEdit}>Edit</button>
            <button className="text-red-600 underline" onClick={onDelete}>Delete</button>
          </div>
        )}
      </div>
    </>
  )
}
