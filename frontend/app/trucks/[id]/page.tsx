'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

type PM = {
  odometer: number
  oil_next_due: number
  oil_miles_remaining: number
  chassis_next_due: number
  chassis_miles_remaining: number
}
type Report = {
  id: number
  created_at: string
  status?: string
  defects?: Array<{
    id: number
    description?: string | null
    resolved: boolean
    resolved_at?: string | null
    notes?: Array<{ id:number; text:string; created_at:string; author?:{ name?:string } }>
  }>
}
type FlatDefect = {
  id: number
  description?: string | null
  resolved: boolean
  resolved_at?: string | null
  _reported_at: string
  _report_id: number
  notes?: Array<{ id:number; text:string; created_at:string; author?:{ name?:string } }>
}

function fmtDate(value: string | number | Date) {
  const d = new Date(value)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const y = d.getFullYear()
  return `${m}-${day}-${y}`
}
const fmtNum = (v: any) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : (v ?? '—')
}

export default function TruckDetailPage() {
  return (
    <RequireAuth>
      <TruckDetailInner />
    </RequireAuth>
  )
}

function TruckDetailInner() {
  const { id } = useParams() as { id: string }

  const [truck, setTruck] = useState<any>(null)
  const [truckErr, setTruckErr] = useState<string | null>(null)

  const [reports, setReports] = useState<Report[]>([])
  const [reportsErr, setReportsErr] = useState<string | null>(null)

  const [pm, setPm] = useState<PM | null>(null)
  const [pmErr, setPmErr] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)

  // Add Issue + Photos + optional note (left column)
  const [issue, setIssue] = useState('')
  const [issueNote, setIssueNote] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Per-issue inline note inputs (right column)
  const [noteTextByDefect, setNoteTextByDefect] = useState<Record<number, string>>({})

  // Which panel to show on the right? ('active' | 'resolved' | null)
  const [rightPanel, setRightPanel] = useState<'active' | 'resolved' | null>('active')

  // Pagination (10/page)
  const PAGE_SIZE = 10
  const [activePage, setActivePage] = useState(1)
  const [resolvedPage, setResolvedPage] = useState(1)

  async function fetchJson(url: string) {
    const r = await fetch(url, { headers: authHeaders() })
    if (!r.ok) {
      let msg = ''
      try { msg = await r.text() } catch {}
      throw new Error(`${r.status} ${r.statusText}${msg ? ` – ${msg}` : ''}`)
    }
    return r.json()
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setTruckErr(null); setReportsErr(null); setPmErr(null)

    ;(async () => {
      try {
        const [t, r, p] = await Promise.allSettled([
          fetchJson(`${API}/trucks/${id}`),
          fetchJson(`${API}/trucks/${id}/reports?limit=2000`),
          fetchJson(`${API}/trucks/${id}/pm-next`),
        ])

        if (!cancelled) {
          if (t.status === 'fulfilled') setTruck(t.value)
          else setTruckErr(t.reason?.message || 'Failed to load truck')

          if (r.status === 'fulfilled') setReports(Array.isArray(r.value) ? r.value : [])
          else setReportsErr(r.reason?.message || 'Failed to load reports')

          if (p.status === 'fulfilled') setPm(p.value as PM)
          else setPmErr(p.reason?.message || 'Failed to load PM status')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [id])

  // Flatten defects for active/resolved lists
  const allIssues: FlatDefect[] = useMemo(() => {
    const rows: FlatDefect[] = []
    for (const r of reports || []) {
      const ds = r?.defects || []
      for (const d of ds) {
        rows.push({
          id: d.id,
          description: d.description ?? '',
          resolved: d.resolved,
          resolved_at: d.resolved_at ?? null,
          _reported_at: r.created_at,
          _report_id: r.id,
          notes: (d as any)?.notes || [],
        })
      }
    }
    rows.sort((a, b) => new Date(b._reported_at).getTime() - new Date(a._reported_at).getTime())
    return rows
  }, [reports])

  const activeIssues = useMemo(() => allIssues.filter(i => !i.resolved), [allIssues])
  const resolvedIssues = useMemo(() => allIssues.filter(i => i.resolved), [allIssues])

  const activeTotalPages = Math.max(1, Math.ceil(activeIssues.length / PAGE_SIZE))
  const resolvedTotalPages = Math.max(1, Math.ceil(resolvedIssues.length / PAGE_SIZE))

  const activeSlice = useMemo(() => {
    const start = (activePage - 1) * PAGE_SIZE
    return activeIssues.slice(start, start + PAGE_SIZE)
  }, [activeIssues, activePage])

  const resolvedSlice = useMemo(() => {
    const start = (resolvedPage - 1) * PAGE_SIZE
    return resolvedIssues.slice(start, start + PAGE_SIZE)
  }, [resolvedIssues, resolvedPage])

  async function refreshData() {
    try {
      const r = await fetch(`${API}/trucks/${id}/reports?limit=2000`, { headers: authHeaders() })
      if (r.ok) setReports(await r.json())
      const p = await fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() })
      if (p.ok) setPm(await p.json())
    } catch {}
  }

  async function ensureOpenReport(): Promise<Report | null> {
    const open = reports.find(r => (r as any)?.status === 'OPEN')
    if (open) return open
    const r = await fetch(`${API}/trucks/${id}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        odometer: Number(truck?.odometer || 0),
        summary: '',
        type: 'pre',
      }),
    })
    if (!r.ok) { alert(await r.text().catch(()=> 'Failed to create report')); return null }
    const created = await r.json()
    setReports(prev => [created as Report, ...prev])
    return created as Report
  }

  // Add Issue (+ photos) with optional note
  async function addIssueWithPhotos(e: React.FormEvent) {
    e.preventDefault()
    const text = issue.trim()
    const noteText = issueNote.trim()
    if (!text && !files?.length) return
    const rep = await ensureOpenReport()
    if (!rep) return

    const r1 = await fetch(`${API}/reports/${rep.id}/defects`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ component: 'general', severity: 'minor', description: text }),
    })
    if (!r1.ok) { alert(await r1.text().catch(()=> 'Failed to add issue')); return }
    const defect = await r1.json()

    if (files && files.length > 0) {
      const fd = new FormData()
      Array.from(files).forEach(f => fd.append('files', f))
      const r2 = await fetch(`${API}/defects/${defect.id}/photos`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      })
      if (!r2.ok) { alert(await r2.text().catch(()=> 'Failed to upload photos')); return }
    }

    if (noteText) {
      const r3 = await fetch(`${API}/defects/${defect.id}/notes`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ text: noteText }),
      })
      if (!r3.ok) { alert(await r3.text().catch(()=> 'Failed to add note')) }
    }

    setIssue(''); setIssueNote('')
    setFiles(null); if (fileRef.current) fileRef.current.value = ''
    await refreshData()
    setRightPanel('active')
    setActivePage(1) // jump to first page so the new issue is visible
  }

  // Inline add note for an existing defect (right column)
  async function addNoteForDefect(defectId: number) {
    const text = (noteTextByDefect[defectId] || '').trim()
    if (!text) return
    const r = await fetch(`${API}/defects/${defectId}/notes`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ text }),
    })
    if (!r.ok) { alert(await r.text().catch(()=> 'Failed to add note')); return }
    setNoteTextByDefect(prev => ({ ...prev, [defectId]: '' }))
    await refreshData()
  }

  // Anyone can add service (per your request)
  async function addService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload = {
      service_type: String(fd.get('service_type') || 'oil'),
      odometer: Number(fd.get('odometer') || 0),
    }
    const r = await fetch(`${API}/trucks/${id}/service`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    })
    if (!r.ok) { alert(await r.text().catch(()=> 'Failed to save service')); return }
    setPm(await r.json())
    e.currentTarget.reset()
  }

  if (loading) return <main className="p-4 text-sm">Loading…</main>

  return (
    <main className="px-4 py-5">
      {/* Left-align the whole page: NO centering container */}
      <div className="max-w-6xl">
        {/* Header row */}
        <div className="flex items-baseline gap-2 mb-4">
          <Link href="/trucks" className="text-xs underline">&larr; Back to trucks</Link>
          <div className="ml-auto text-xs text-gray-500">
            {pmErr && <span className="text-red-600">PM: {pmErr}</span>}
            {reportsErr && <span className="text-red-600 ml-3">Reports: {reportsErr}</span>}
          </div>
        </div>

        <div className="flex items-baseline gap-2 mb-3">
          <h1 className="text-xl font-semibold">
            {truck ? <>Truck #{truck.number}</> : 'Truck'}
          </h1>
          {truckErr && <span className="text-xs text-red-600">({truckErr})</span>}
        </div>

        {/* PM snapshot (compact) */}
        {pm && (
          <div className="border rounded-lg p-3 mb-4 max-w-2xl">
            <div className="font-semibold text-sm">PM Status</div>
            <div className="text-sm">Odometer: {fmtNum(pm.odometer)} mi</div>
            <div className="text-sm">Oil next due: {fmtNum(pm.oil_next_due)} (in {fmtNum(pm.oil_miles_remaining)} mi)</div>
            <div className="text-sm">Chassis next due: {fmtNum(pm.chassis_next_due)} (in {fmtNum(pm.chassis_miles_remaining)} mi)</div>
          </div>
        )}

        {/* Two-column layout; right side is sticky */}
        <div className="grid gap-4 md:grid-cols-[minmax(280px,360px)_1fr]">
          {/* LEFT COLUMN (narrow): Add forms + headings */}
          <div className="space-y-3">
            {/* Add Issue */}
            <section className="border rounded-lg p-3">
              <div className="font-semibold text-sm mb-2">Add Issue</div>
              <form onSubmit={addIssueWithPhotos} className="grid gap-2">
                <input
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  placeholder="Describe the issue"
                  className="border px-2 py-1 text-sm rounded-lg"
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="border px-2 py-1 text-sm rounded-lg"
                  onChange={(e) => setFiles(e.currentTarget.files)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={issueNote}
                    onChange={(e) => setIssueNote(e.target.value)}
                    placeholder="Add a note (optional)"
                    className="border px-2 py-1 text-sm rounded-lg col-span-2"
                  />
                  <button className="border rounded-lg px-2 py-1 text-xs col-span-1">
                    Add Issue
                  </button>
                  <button
                    type="button"
                    onClick={addIssueWithPhotos}
                    className="border rounded-lg px-2 py-1 text-xs col-span-1"
                  >
                    Save with Note
                  </button>
                </div>
              </form>
            </section>

            {/* Add Service (directly below Add Issue) */}
            <section className="border rounded-lg p-3">
              <div className="font-semibold text-sm mb-2">Add Service</div>
              <form onSubmit={addService} className="grid gap-2">
                <select name="service_type" className="border px-2 py-1 text-sm rounded-lg">
                  <option value="oil">Oil change</option>
                  <option value="chassis">Chassis lube</option>
                </select>
                <input
                  name="odometer"
                  placeholder="Odometer"
                  className="border px-2 py-1 text-sm rounded-lg"
                  required
                />
                <button className="border rounded-lg px-2 py-1 text-xs">Log Service</button>
              </form>
            </section>

            {/* Short clickable headings */}
            <button
              onClick={() => setRightPanel('active')}
              className={`w-full text-left border rounded-lg px-3 py-2 text-sm font-medium ${rightPanel==='active' ? 'bg-gray-50' : ''}`}
            >
              Active Issues ({activeIssues.length})
            </button>
            <button
              onClick={() => setRightPanel('resolved')}
              className={`w-full text-left border rounded-lg px-3 py-2 text-sm font-medium ${rightPanel==='resolved' ? 'bg-gray-50' : ''}`}
            >
              Resolved Issues ({resolvedIssues.length})
            </button>
          </div>

          {/* RIGHT COLUMN (sticky detail panel) */}
          <div className="space-y-4 md:sticky md:top-4 self-start">
            {rightPanel === 'active' && (
              <IssuesPanel
                title="Active Issues"
                total={activeIssues.length}
                page={activePage}
                setPage={setActivePage}
                totalPages={Math.max(1, Math.ceil(activeIssues.length / PAGE_SIZE))}
                items={activeSlice}
                noteTextByDefect={noteTextByDefect}
                setNoteTextByDefect={setNoteTextByDefect}
                addNoteForDefect={addNoteForDefect}
                reportsErr={reportsErr}
              />
            )}

            {rightPanel === 'resolved' && (
              <IssuesPanel
                title="Resolved Issues"
                total={resolvedIssues.length}
                page={resolvedPage}
                setPage={setResolvedPage}
                totalPages={Math.max(1, Math.ceil(resolvedIssues.length / PAGE_SIZE))}
                items={resolvedSlice}
                noteTextByDefect={noteTextByDefect}
                setNoteTextByDefect={setNoteTextByDefect}
                addNoteForDefect={addNoteForDefect}
                reportsErr={reportsErr}
                resolved
              />
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

/* ---------- Right column Issues panel ---------- */

function IssuesPanel({
  title,
  total,
  page,
  setPage,
  totalPages,
  items,
  noteTextByDefect,
  setNoteTextByDefect,
  addNoteForDefect,
  reportsErr,
  resolved = false,
}: {
  title: string
  total: number
  page: number
  setPage: (n: number) => void
  totalPages: number
  items: FlatDefect[]
  noteTextByDefect: Record<number, string>
  setNoteTextByDefect: React.Dispatch<React.SetStateAction<Record<number, string>>>
  addNoteForDefect: (id: number) => void
  reportsErr: string | null
  resolved?: boolean
}) {
  return (
    <section className="border rounded-lg overflow-hidden">
      <div className="p-3 font-semibold text-sm border-b flex items-center justify-between">
        <span>{title}</span>
        <span className="text-xs text-gray-500">
          {reportsErr ? <span className="text-red-600">{reportsErr}</span> : `${total} total`}
        </span>
      </div>

      {total === 0 ? (
        <div className="p-3 text-sm text-gray-500">No {resolved ? 'resolved' : 'active'} issues.</div>
      ) : (
        <>
          <div className="divide-y">
            {items.map(i => (
              <div key={i.id} className="p-3 text-sm space-y-2">
                <div className="font-medium">{i.description || '(no description)'}</div>
                <div className="text-xs text-gray-600">
                  Reported {fmtDate(i._reported_at)}
                  {resolved && (
                    <> · Resolved {i.resolved_at ? fmtDate(i.resolved_at) : '(date not recorded)'}</>
                  )}
                </div>

                {i.notes && i.notes.length > 0 && (
                  <div className="text-xs">
                    <div className="text-gray-600 mb-1">Notes</div>
                    <ul className="list-disc ml-5 space-y-0.5">
                      {i.notes.map(n => (
                        <li key={n.id}>
                          {n.text}{' '}
                          <span className="text-gray-400">({fmtDate(n.created_at)})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Inline add note */}
                <div className="flex items-center gap-2">
                  <input
                    value={noteTextByDefect[i.id] || ''}
                    onChange={(e) => setNoteTextByDefect(prev => ({ ...prev, [i.id]: e.target.value }))}
                    placeholder="Add note"
                    className="border px-2 py-1 text-sm rounded-lg flex-1"
                  />
                  <button
                    className="border rounded-lg px-2 py-1 text-xs"
                    onClick={() => addNoteForDefect(i.id)}
                  >
                    Add Note
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between p-3 text-xs">
            <span>Page {page} of {totalPages}</span>
            <div className="space-x-2">
              <button
                className="border rounded px-2 py-1 disabled:opacity-50"
                disabled={page <= 1}
                onClick={() => setPage(Math.max(1, page - 1))}
              >
                Prev
              </button>
              <button
                className="border rounded px-2 py-1 disabled:opacity-50"
                disabled={page >= totalPages}
                onClick={() => setPage(Math.min(totalPages, page + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
