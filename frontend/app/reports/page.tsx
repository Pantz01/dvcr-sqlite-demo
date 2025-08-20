// app/reports/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders } from '@/lib/api'
import { useSearchParams } from 'next/navigation'

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
  author?: { name?: string }
}

type Defect = {
  id: number
  description?: string | null
  resolved: boolean
  resolved_at?: string | null
  component?: string | null
  severity?: string | null
}

type Report = {
  id: number
  truck_id: number
  created_at: string
  odometer?: number | null
  status: 'OPEN' | 'CLOSED' | string
  summary?: string | null
  type: 'pre' | 'post' | string
  defects?: Defect[]
  notes?: Note[]
}

/* ---- tiny date helper (M-D-YYYY) ---- */
function formatDateMDY(input?: string | number | Date | null) {
  if (!input) return ''
  const d = new Date(input)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`
}

/* Flattened issue row: one per defect, carrying its report context + notes */
type FlatIssue = {
  key: string
  reportId: number
  reportDate: string
  description: string
  resolved: boolean
  resolved_at?: string | null
  component?: string | null
  severity?: string | null
  notes: Note[]
}

export default function ReportsPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <ReportsInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function ReportsInner() {
  const searchParams = useSearchParams()

  const [trucks, setTrucks] = useState<Truck[]>([])
  const [truckId, setTruckId] = useState<number | null>(null)

  const [issues, setIssues] = useState<FlatIssue[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')

  // read ?truckId= from URL (optional)
  useEffect(() => {
    const qId = searchParams?.get('truckId')
    if (qId) setTruckId(Number(qId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadTrucks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (truckId) loadAllIssuesForTruck(truckId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckId])

  async function loadTrucks() {
    setError(null)
    try {
      const r = await fetch(`${API}/trucks`, { headers: authHeaders() })
      if (!r.ok) throw new Error(await r.text())
      const list: Truck[] = await r.json()
      setTrucks(list)
      if (!truckId) {
        const prefer = searchParams?.get('truckId')
        if (prefer && list.some(t => t.id === Number(prefer))) {
          setTruckId(Number(prefer))
        } else if (list.length) {
          setTruckId(list[0].id)
        }
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load trucks')
      setTrucks([])
    }
  }

  // Page through a truck’s reports using X-Total-Count/skip/limit, then flatten defects + include report notes
  async function loadAllIssuesForTruck(tid: number) {
    setBusy(true)
    setError(null)
    try {
      const limit = 500
      let skip = 0
      let total = Infinity
      const allReports: Report[] = []

      while (skip < total) {
        const r = await fetch(`${API}/trucks/${tid}/reports?skip=${skip}&limit=${limit}`, {
          headers: authHeaders(),
        })
        if (!r.ok) throw new Error(await r.text())
        const data: Report[] = await r.json()
        const t = Number(r.headers.get('X-Total-Count') || '0')
        total = Number.isFinite(t) && t > 0 ? t : data.length
        allReports.push(...data)
        skip += limit
        if (!Number.isFinite(t) && data.length < limit) break
      }

      const flat: FlatIssue[] = []
      for (const rep of allReports) {
        const notes = Array.isArray(rep.notes) ? rep.notes : []
        const defects = Array.isArray(rep.defects) ? rep.defects : []
        for (const d of defects) {
          flat.push({
            key: `${rep.id}:${d.id}`,
            reportId: rep.id,
            reportDate: rep.created_at,
            description: d.description || '',
            resolved: !!d.resolved,
            resolved_at: d.resolved_at,
            component: d.component,
            severity: d.severity,
            notes,
          })
        }
      }

      // newest first by report date
      flat.sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime())
      setIssues(flat)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load issues')
      setIssues([])
    } finally {
      setBusy(false)
    }
  }

  // Search over description and notes
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return issues
    return issues.filter(it => {
      const inDesc = (it.description || '').toLowerCase().includes(q)
      const inNotes = it.notes.some(n => (n.text || '').toLowerCase().includes(q))
      const inMeta =
        (it.component || '').toLowerCase().includes(q) ||
        (it.severity || '').toLowerCase().includes(q)
      return inDesc || inNotes || inMeta
    })
  }, [issues, query])

  const unresolved = filtered.filter(i => !i.resolved)
  const resolved = filtered.filter(i => i.resolved)

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Reports</h1>
        <ExportAllIssuesButton />
      </div>

      {/* Controls (Truck + Search) */}
      <div className="border rounded-2xl p-4 grid md:grid-cols-3 gap-3 items-end">
        <label className="grid gap-1 text-sm md:col-span-1">
          <span className="text-gray-600">Truck</span>
          <select
            className="border p-2 rounded-xl"
            value={truckId ?? ''}
            onChange={(e) => setTruckId(Number(e.target.value) || null)}
          >
            {trucks.map(t => (
              <option key={t.id} value={t.id}>
                {t.number} {t.active ? '' : '(Inactive)'}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-gray-600">Search</span>
          <input
            className="border p-2 rounded-xl"
            placeholder="Search issues and notes (e.g., 'brake', 'leak', 'left marker')"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
        <span>
          Total issues: <b>{filtered.length}</b>
        </span>
        <span className="opacity-60">•</span>
        <span>
          Unresolved: <b>{unresolved.length}</b>
        </span>
        <span className="opacity-60">•</span>
        <span>
          Resolved: <b>{resolved.length}</b>
        </span>
        {busy && <span className="opacity-60">• Loading…</span>}
      </div>

      {/* Issues lists */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Unresolved */}
        <div className="border rounded-2xl overflow-hidden">
          <div className="p-3 font-semibold border-b">Unresolved Issues</div>
          {busy && unresolved.length === 0 ? (
            <div className="p-3 text-sm text-gray-500">Loading…</div>
          ) : unresolved.length === 0 ? (
            <div className="p-3 text-sm text-gray-500">No unresolved issues.</div>
          ) : (
            <div className="divide-y">
              {unresolved.map(i => (
                <IssueRow key={i.key} issue={i} />
              ))}
            </div>
          )}
        </div>

        {/* Resolved */}
        <div className="border rounded-2xl overflow-hidden">
          <div className="p-3 font-semibold border-b">Resolved Issues</div>
          {busy && resolved.length === 0 ? (
            <div className="p-3 text-sm text-gray-500">Loading…</div>
          ) : resolved.length === 0 ? (
            <div className="p-3 text-sm text-gray-500">No resolved issues.</div>
          ) : (
            <div className="divide-y">
              {resolved.map(i => (
                <IssueRow key={i.key} issue={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function IssueRow({ issue }: { issue: FlatIssue }) {
  const badge = (label: string) => (
    <span className="inline-block px-1.5 py-0.5 text-[11px] rounded border">{label}</span>
  )

  return (
    <div className="p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">{issue.description || '(no description)'}</div>
        <span className="opacity-60">•</span>
        <div className="text-gray-600">Date: {formatDateMDY(issue.reportDate)}</div>
        {issue.component ? badge(issue.component) : null}
        {issue.severity ? badge(issue.severity) : null}
        {issue.resolved && issue.resolved_at ? (
          <>
            <span className="opacity-60">•</span>
            <div className="text-gray-600">Resolved: {formatDateMDY(issue.resolved_at)}</div>
          </>
        ) : null}
      </div>

      {/* Notes under each issue (from the source report) */}
      {issue.notes.length > 0 ? (
        <div className="mt-2 space-y-2">
          {issue.notes.map(n => (
            <div key={n.id} className="border rounded-lg p-2">
              <div className="text-[11px] text-gray-600 mb-1">
                {formatDateMDY(n.created_at)}
                {n.author?.name ? ` · ${n.author.name}` : ''}
              </div>
              <div className="text-sm">{n.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-xs text-gray-500">No notes.</div>
      )}
    </div>
  )
}

/* =======================
   Export All Issues (CSV)
   ======================= */

function ExportAllIssuesButton() {
  const [busy, setBusy] = useState(false)

  async function fetchWithHeaders(url: string) {
    const r = await fetch(url, { headers: authHeaders() })
    if (!r.ok) throw new Error(await r.text().catch(() => 'Request failed'))
    const data = await r.json()
    const total = Number(r.headers.get('X-Total-Count') || '0')
    return { data, total }
  }

  // Page through a truck’s reports using X-Total-Count/skip/limit
  async function fetchAllReportsForTruck(API: string, truckId: number) {
    const all: any[] = []
    const limit = 500
    let skip = 0
    let total = Infinity

    while (skip < total) {
      const { data, total: t } = await fetchWithHeaders(
        `${API}/trucks/${truckId}/reports?skip=${skip}&limit=${limit}`
      )
      total = isFinite(t) && t > 0 ? t : data.length
      all.push(...data)
      skip += limit
      if (!isFinite(t) && data.length < limit) break
    }
    return all
  }

  function toCsv(rows: Record<string, any>[], headers: string[]) {
    const escapeCell = (v: any) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines: string[] = []
    lines.push(headers.join(','))
    if (rows.length === 0) {
      lines.push([ '', '', '', '' ].join(','))
    } else {
      for (const row of rows) {
        lines.push(headers.map(h => escapeCell(row[h])).join(','))
      }
    }
    return lines.join('\n')
  }

  async function exportAllIssuesCsv() {
    try {
      setBusy(true)

      // 1) Get all trucks
      const trucksRes = await fetch(`${API}/trucks`, { headers: authHeaders() })
      if (!trucksRes.ok) throw new Error(await trucksRes.text())
      const trucks: { id:number; number:string }[] = await trucksRes.json()

      // 2) For each truck, fetch reports (paged) and flatten defects
      const allRows: Record<string, any>[] = []
      for (const t of trucks) {
        const reports = await fetchAllReportsForTruck(API, t.id)
        for (const r of reports) {
          const createdAt = r?.created_at
          const defects = Array.isArray(r?.defects) ? r.defects : []
          for (const d of defects) {
            const issueDate = createdAt ? formatDateMDY(createdAt) : ''
            const issueText = d?.description ?? ''
            const resolvedDate = d?.resolved
              ? (d?.resolved_at ? formatDateMDY(d.resolved_at) : '')
              : 'Unresolved'
            allRows.push({
              'Truck': t.number ?? t.id,
              'Date of Issue': issueDate,
              'Issue': issueText,
              'Date Resolved / Status': resolvedDate,
            })
          }
        }
      }

      // 3) Build + download CSV (date-only, no time)
      const headers = ['Truck', 'Date of Issue', 'Issue', 'Date Resolved / Status']
      const csv = toCsv(allRows, headers)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const ts = formatDateMDY(new Date()) // cleaner filename date
      a.download = `all-trucks-issues-${ts}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err: any) {
      alert(err?.message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={exportAllIssuesCsv}
      disabled={busy}
      className="px-2.5 py-1 text-xs border rounded-md disabled:opacity-50"
      title="Export all issues for all trucks"
    >
      {busy ? 'Exporting…' : 'Export All Issues'}
    </button>
  )
}
