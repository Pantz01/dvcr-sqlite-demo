'use client'

import { useEffect, useMemo, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'
import Link from 'next/link'
import { useParams, useSearchParams, useRouter } from 'next/navigation'

type UserOut = { id: number; name: string; email: string; role: string }
type TruckOut = { id: number; number: string; vin?: string | null; active: boolean; odometer: number }
type PhotoOut = { id: number; path: string; caption?: string | null }
type DefectOut = {
  id: number; component: string; severity: string; description?: string | null;
  x?: number | null; y?: number | null; resolved: boolean; resolved_by_id?: number | null;
  resolved_at?: string | null; photos: PhotoOut[];
}
type NoteOut = { id: number; author: UserOut; text: string; created_at: string }
type ReportOut = {
  id: number; truck: TruckOut; driver: UserOut; created_at: string;
  odometer?: number | null; status: string; summary?: string | null; type: 'pre' | 'post';
  defects: DefectOut[]; notes: NoteOut[];
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  })
  return q.toString()
}

export default function AdminTruckReportsPage() {
  const { id } = useParams<{ id: string }>()
  const sp = useSearchParams()
  const router = useRouter()

  const [truck, setTruck] = useState<TruckOut | null>(null)
  const [reports, setReports] = useState<ReportOut[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  // filters
  const [typeFilter, setTypeFilter] = useState<'pre' | 'post' | 'all'>(
    (sp.get('type') as any) === 'pre' || (sp.get('type') as any) === 'post' ? (sp.get('type') as 'pre' | 'post') : 'all'
  )
  const [page, setPage] = useState<number>(Number(sp.get('page') || 1))
  const [limit, setLimit] = useState<number>(Number(sp.get('limit') || 20))

  const skip = useMemo(() => (page - 1) * limit, [page, limit])
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit])

  // keep URL in sync (useful for reload/share)
  useEffect(() => {
    const qs = buildQuery({
      type: typeFilter === 'all' ? undefined : typeFilter,
      page,
      limit,
    })
    router.replace(`?${qs}`)
  }, [typeFilter, page, limit, router])

  useEffect(() => {
    setLoading(true)
    // truck
    fetch(`${API}/trucks/${id}`, { headers: authHeaders() as HeadersInit })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(setTruck)
      .catch(() => setTruck(null))

    // reports
    const qs = buildQuery({
      type: typeFilter === 'all' ? undefined : typeFilter,
      skip,
      limit,
    })
    fetch(`${API}/trucks/${id}/reports?${qs}`, { headers: authHeaders() as HeadersInit })
      .then(async r => {
        const total = r.headers.get('X-Total-Count')
        if (total) setTotal(Number(total))
        const data = await r.json()
        if (!r.ok) throw data
        return data
      })
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setLoading(false))
  }, [id, typeFilter, skip, limit])

  async function deleteReport(repId: number) {
    if (!confirm('Delete this report? This cannot be undone.')) return
    const res = await fetch(`${API}/reports/${repId}`, { method: 'DELETE', headers: authHeaders() as HeadersInit })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err?.detail || 'Failed to delete')
      return
    }
    // refresh
    const qs = buildQuery({
      type: typeFilter === 'all' ? undefined : typeFilter,
      skip,
      limit,
    })
    const r2 = await fetch(`${API}/trucks/${id}/reports?${qs}`, { headers: authHeaders() as HeadersInit })
    const total2 = r2.headers.get('X-Total-Count')
    if (total2) setTotal(Number(total2))
    setReports(await r2.json())
  }

  async function editReport(rep: ReportOut) {
    // very MVP: quick prompts
    const status = prompt("Status (OPEN/CLOSED)?", rep.status || 'OPEN') || rep.status
    const type = (prompt("Type (pre/post)?", rep.type) || rep.type) as 'pre' | 'post'
    const odometerStr = prompt("Odometer (number or blank):", rep.odometer?.toString() || '') || ''
    const odometer = odometerStr.trim() === '' ? undefined : Number(odometerStr)
    const summary = prompt("Summary (optional):", rep.summary || '') ?? rep.summary

    const body: Record<string, any> = { status, type, summary }
    if (odometer !== undefined && !Number.isNaN(odometer)) body.odometer = odometer

    const res = await fetch(`${API}/reports/${rep.id}`, {
      method: 'PATCH',
      headers: jsonHeaders() as HeadersInit,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err?.detail || 'Failed to update')
      return
    }
    // refresh current page
    const qs = buildQuery({
      type: typeFilter === 'all' ? undefined : typeFilter,
      skip,
      limit,
    })
    const r2 = await fetch(`${API}/trucks/${id}/reports?${qs}`, { headers: authHeaders() as HeadersInit })
    const total2 = r2.headers.get('X-Total-Count')
    if (total2) setTotal(Number(total2))
    setReports(await r2.json())
  }

  return (
    <RequireAuth>
      <RoleGuard roles={['manager','admin']}>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/admin/trucks" className="text-sm underline">&larr; Back</Link>
            <h1 className="text-xl font-semibold">Truck Admin — Reports</h1>
            {truck && (
              <span className="text-sm text-gray-600">
                Truck #{truck.number} · Odo: {truck.odometer?.toLocaleString() ?? 0}
              </span>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">Type:</label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={typeFilter}
              onChange={e => { setPage(1); setTypeFilter(e.target.value as any) }}
            >
              <option value="all">All</option>
              <option value="pre">Pre-trip</option>
              <option value="post">Post-trip</option>
            </select>

            <div className="flex-1" />
            <label className="text-sm">Per page:</label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={limit}
              onChange={e => { setPage(1); setLimit(Number(e.target.value)) }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2">ID</th>
                  <th className="text-left p-2">Created</th>
                  <th className="text-left p-2">Driver</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Odometer</th>
                  <th className="text-left p-2">Summary</th>
                  <th className="text-left p-2">Defects</th>
                  <th className="text-left p-2">Notes</th>
                  <th className="text-left p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={10} className="p-3 text-center text-gray-500">Loading…</td></tr>
                )}
                {!loading && reports.length === 0 && (
                  <tr><td colSpan={10} className="p-3 text-center text-gray-500">No reports</td></tr>
                )}
                {!loading && reports.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.id}</td>
                    <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="p-2">{r.driver?.name}</td>
                    <td className="p-2 uppercase">{r.type}</td>
                    <td className="p-2">{r.status}</td>
                    <td className="p-2">{r.odometer?.toLocaleString?.() ?? ''}</td>
                    <td className="p-2 max-w-[24rem] truncate" title={r.summary || ''}>{r.summary}</td>
                    <td className="p-2">{r.defects?.length ?? 0}</td>
                    <td className="p-2">{r.notes?.length ?? 0}</td>
                    <td className="p-2 space-x-2">
                      <button
                        onClick={() => editReport(r)}
                        className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteReport(r.id)}
                        className="px-2 py-1 text-xs border rounded text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                      <Link
                        className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
                        href={`/trucks/${id}?report=${r.id}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-3">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              Prev
            </button>
            <span className="text-sm">
              Page {page} / {totalPages} &middot; {total.toLocaleString()} total
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </RoleGuard>
    </RequireAuth>
  )
}
