// app/reports/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'
import { useRouter, useSearchParams } from 'next/navigation'

type Truck = {
  id: number
  number: string
  vin?: string | null
  active: boolean
  odometer: number
}

type Defect = {
  id: number
  description?: string | null
  resolved: boolean
  component?: string | null
  severity?: string | null
}

type Note = {
  id: number
  text: string
  created_at: string
  author?: { name?: string }
}

type Report = {
  id: number
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
  const router = useRouter()
  const searchParams = useSearchParams()

  const [trucks, setTrucks] = useState<Truck[]>([])
  const [truckId, setTruckId] = useState<number | null>(null)

  const [reports, setReports] = useState<Report[]>([])
  const [total, setTotal] = useState(0)
  const [skip, setSkip] = useState(0)
  const [limit, setLimit] = useState(25)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [active, setActive] = useState<Report | null>(null)

  const [filterType, setFilterType] = useState<'all' | 'pre' | 'post'>('all')
  const [filterText, setFilterText] = useState('')
  const [unresolvedOnly, setUnresolvedOnly] = useState(false) // NEW

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
    if (truckId) loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckId, skip, limit, filterType])

  async function loadTrucks() {
    setError(null)
    try {
      const r = await fetch(`${API}/trucks`, { headers: authHeaders() })
      if (!r.ok) throw new Error(await r.text())
      const list: Truck[] = await r.json()
      setTrucks(list)
      if (!truckId) {
        // prefer URL param if it exists
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

  async function loadReports() {
    if (!truckId) return
    setLoading(true)
    setError(null)
    try {
      const typeParam = filterType === 'all' ? '' : `&type=${filterType}`
      const r = await fetch(`${API}/trucks/${truckId}/reports?skip=${skip}&limit=${limit}${typeParam}`, {
        headers: authHeaders(),
      })
      if (!r.ok) throw new Error(await r.text())
      const items: Report[] = await r.json()
      const totalCount = Number(r.headers.get('X-Total-Count') || '0')
      setReports(items)
      setTotal(Number.isFinite(totalCount) ? totalCount : items.length)
      setActive(items[0] || null)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load reports')
      setReports([])
      setTotal(0)
      setActive(null)
    } finally {
      setLoading(false)
    }
  }

  // hydrate a single report (with defects/notes)
  async function openReport(id: number) {
    try {
      const rr = await fetch(`${API}/reports/${id}`, { headers: authHeaders() })
      if (!rr.ok) throw new Error(await rr.text())
      setActive(await rr.json())
    } catch (e: any) {
      alert(e?.message ?? 'Failed to open report')
    }
  }

  // pagination helpers
  const page = Math.floor(skip / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))
  function goPage(p: number) {
    const clamped = Math.max(1, Math.min(p, pages))
    setSkip((clamped - 1) * limit)
  }

  // --- report field updates ---
  async function patchReport(patch: Partial<Pick<Report, 'odometer' | 'summary' | 'status' | 'type'>>) {
    if (!active) return
    try {
      const r = await fetch(`${API}/reports/${active.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(patch),
      })
      if (!r.ok) throw new Error(await r.text())
      await openReport(active.id) // refresh details
      await loadReports()         // refresh list row
    } catch (e: any) {
      alert(e?.message ?? 'Failed to update report')
    }
  }

  async function deleteReport() {
    if (!active) return
    if (!confirm('Delete this report? This will remove its issues and notes.')) return
    try {
      const r = await fetch(`${API}/reports/${active.id}`, { method: 'DELETE', headers: authHeaders() })
      if (!r.ok && r.status !== 204) throw new Error(await r.text())
      await loadReports()
    } catch (e: any) {
      alert(e?.message ?? 'Failed to delete report')
    }
  }

  // --- defects (issues) ---
  async function addDefect(text: string) {
    if (!active) return
    const body = { component: 'general', severity: 'minor', description: text.trim() }
    if (!body.description) return
    try {
      const r = await fetch(`${API}/reports/${active.id}/defects`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(await r.text())
      await openReport(active.id)
    } catch (e: any) {
      alert(e?.message ?? 'Failed to add issue')
    }
  }

  async function editDefect(d: Defect) {
    const next = prompt('Update issue text:', d.description || '') ?? ''
    try {
      const r = await fetch(`${API}/defects/${d.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ description: next }),
      })
      if (!r.ok) throw new Error(await r.text())
      if (active) await openReport(active.id)
    } catch (e: any) {
      alert(e?.message ?? 'Failed to update issue')
    }
  }

  async function toggleResolved(d: Defect) {
    try {
      const r = await fetch(`${API}/defects/${d.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ resolved: !d.resolved }),
      })
      if (!r.ok) throw new Error(await r.text())
      if (active) await openReport(active.id)
    } catch (e: any) {
      alert(e?.message ?? 'Failed to toggle issue')
    }
  }

  async function deleteDefect(id: number) {
    if (!confirm('Delete this issue?')) return
    try {
      const r = await fetch(`${API}/defects/${id}`, { method: 'DELETE', headers: authHeaders() })
      if (!r.ok && r.status !== 204) throw new Error(await r.text())
      if (active) await openReport(active.id)
    } catch (e: any) {
      alert(e?.message ?? 'Failed to delete issue')
    }
  }

  // client-side filters over list rows
  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    return reports.filter(r => {
      // unresolved-only uses report status as a proxy (OPEN vs CLOSED)
      if (unresolvedOnly && String(r.status).toUpperCase() === 'CLOSED') return false

      if (!q) return true
      const inSummary = (r.summary || '').toLowerCase().includes(q)
      const inDefects = (r.defects || []).some(d => (d.description || '').toLowerCase().includes(q))
      return inSummary || inDefects
    })
  }, [reports, filterText, unresolvedOnly])

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reports</h1>
        <div className="flex items-center gap-2">
          <ExportAllIssuesButton />
          {truckId && (
            <button
              className="inline-flex items-center px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
              onClick={() => router.push(`/admin/trucks/${truckId}`)}
              title="Go to this truck's issues view"
            >
              View Issues
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="border rounded-2xl p-4 grid md:grid-cols-5 gap-3 items-end">
        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-gray-600">Truck</span>
          <select
            className="border p-2 rounded-xl"
            value={truckId ?? ''}
            onChange={(e) => { setSkip(0); setTruckId(Number(e.target.value) || null) }}
          >
            {trucks.map(t => (
              <option key={t.id} value={t.id}>
                {t.number} {t.active ? '' : '(Inactive)'}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-gray-600">Type</span>
          <select
            className="border p-2 rounded-xl"
            value={filterType}
            onChange={(e) => { setSkip(0); setFilterType(e.target.value as any) }}
          >
            <option value="all">All</option>
            <option value="pre">Pre</option>
            <option value="post">Post</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-gray-600">Search</span>
          <input
            className="border p-2 rounded-xl"
            placeholder="Find in summary/issues"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-gray-600">Filters</span>
          <div className="h-10 flex items-center gap-3 border rounded-xl pl-3 pr-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={unresolvedOnly}
                onChange={(e) => setUnresolvedOnly(e.target.checked)}
              />
              Unresolved only
            </label>
          </div>
        </label>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: report list */}
        <div className="border rounded-2xl overflow-hidden">
          <div className="p-3 font-semibold border-b flex items-center justify-between">
            <span>Report List</span>
            <span className="text-xs text-gray-600">Total: {total}</span>
          </div>

          {error ? (
            <div className="p-4 text-sm text-red-600">{error}</div>
          ) : loading ? (
            <div className="p-4 text-sm text-gray-500">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No reports.</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto divide-y">
              {filtered.map(r => (
                <button
                  key={r.id}
                  className={`w-full text-left p-3 hover:bg-gray-50 ${active?.id === r.id ? 'bg-gray-50' : ''}`}
                  onClick={() => openReport(r.id)}
                >
                  <div className="text-sm">
                    {new Date(r.created_at).toLocaleString()} · Odo {r.odometer ?? '—'} · {String(r.status).toUpperCase()}
                  </div>
                  <div className="text-xs text-gray-600 truncate">
                    Type {r.type?.toUpperCase?.() || '—'}{r.summary ? ` · ${r.summary}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Pagination */}
          <div className="p-3 border-t flex items-center justify-between text-sm">
            <div>Page {page} / {Math.max(1, pages)}</div>
            <div className="flex gap-2">
              <button className="border rounded px-2 py-1" onClick={() => goPage(1)} disabled={page <= 1}>⟪</button>
              <button className="border rounded px-2 py-1" onClick={() => goPage(page - 1)} disabled={page <= 1}>‹ Prev</button>
              <button className="border rounded px-2 py-1" onClick={() => goPage(page + 1)} disabled={page >= pages}>Next ›</button>
              <button className="border rounded px-2 py-1" onClick={() => goPage(pages)} disabled={page >= pages}>⟫</button>
            </div>
          </div>
        </div>

        {/* Right: details */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border rounded-2xl">
            <div className="p-3 font-semibold border-b">Details</div>
            {!active ? (
              <div className="p-4 text-sm text-gray-500">Select a report on the left.</div>
            ) : (
              <div className="p-4 space-y-4">
                {/* Header */}
                <div className="text-sm text-gray-700">
                  Created <b>{new Date(active.created_at).toLocaleString()}</b> · Status <b>{active.status}</b>
                </div>

                {/* Editable fields */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <Labeled label="Odometer">
                    <input
                      type="number"
                      defaultValue={active.odometer ?? 0}
                      className="border p-2 rounded-xl w-full"
                      onBlur={(e) => patchReport({ odometer: parseInt(e.target.value || '0', 10) })}
                    />
                  </Labeled>

                  <Labeled label="Type">
                    <select
                      defaultValue={active.type || 'pre'}
                      className="border p-2 rounded-xl w-full"
                      onChange={(e) => patchReport({ type: e.target.value as 'pre' | 'post' })}
                    >
                      <option value="pre">pre</option>
                      <option value="post">post</option>
                    </select>
                  </Labeled>

                  <Labeled label="Summary">
                    <input
                      defaultValue={active.summary ?? ''}
                      className="border p-2 rounded-xl w-full"
                      onBlur={(e) => patchReport({ summary: e.target.value })}
                    />
                  </Labeled>

                  <Labeled label="Status">
                    <select
                      defaultValue={active.status}
                      className="border p-2 rounded-xl w-full"
                      onChange={(e) => patchReport({ status: e.target.value })}
                    >
                      <option value="OPEN">OPEN</option>
                      <option value="CLOSED">CLOSED</option>
                    </select>
                  </Labeled>
                </div>

                {/* Issues */}
                <IssuesPanel
                  defects={active.defects || []}
                  onAdd={addDefect}
                  onEdit={editDefect}
                  onToggle={toggleResolved}
                  onDelete={deleteDefect}
                />

                {/* Danger zone */}
                <div className="border rounded-2xl p-3">
                  <div className="font-semibold mb-2">Danger Zone</div>
                  <button className="border border-red-600 text-red-600 rounded-xl px-3 py-2" onClick={deleteReport}>
                    Delete Report
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      {children}
    </label>
  )
}

function IssuesPanel({
  defects,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  defects: Defect[]
  onAdd: (text: string) => void
  onEdit: (d: Defect) => void
  onToggle: (d: Defect) => void
  onDelete: (id: number) => void
}) {
  const [text, setText] = useState('')
  return (
    <div className="border rounded-2xl overflow-hidden">
      <div className="p-3 font-semibold border-b">Issues</div>

      <div className="p-3 grid sm:grid-cols-5 gap-2">
        <input
          className="border p-2 rounded-xl sm:col-span-4"
          placeholder="Add an issue"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="border rounded-xl p-2"
          onClick={() => { if (text.trim()) { onAdd(text); setText('') } }}
        >
          Add
        </button>
      </div>

      {defects.length === 0 ? (
        <div className="p-3 text-sm text-gray-500">No issues yet.</div>
      ) : (
        <div className="divide-y">
          {defects.map(d => (
            <div key={d.id} className="p-3 flex items-center gap-3 text-sm">
              <div className="flex-1">
                <div className="font-medium">{d.description || '(no description)'}</div>
                <div className="text-xs text-gray-600">{d.resolved ? 'Resolved' : 'Open'}</div>
              </div>
              <button className="text-xs underline" onClick={() => onEdit(d)}>Edit</button>
              <button className="text-xs underline" onClick={() => onToggle(d)}>
                {d.resolved ? 'Reopen' : 'Resolve'}
              </button>
              <button className="text-xs underline text-red-600" onClick={() => onDelete(d.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
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
  async function fetchAllReportsForTruck(truckId: number) {
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
      // Safety stop if server doesn’t send X-Total-Count
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
        const reports = await fetchAllReportsForTruck(t.id)
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
