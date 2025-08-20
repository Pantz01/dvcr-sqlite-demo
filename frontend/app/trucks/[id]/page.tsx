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

  // Add Issue + Photos + optional note
  const [issue, setIssue] = useState('')
  const [issueNote, setIssueNote] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Per-issue inline note inputs
  const [noteTextByDefect, setNoteTextByDefect] = useState<Record<number, string>>({})

  // Pagination (10/page)
  const PAGE_SIZE = 10
  const [activePage, setActivePage] = useState(1)
  const [resolvedPage, setResolvedPage] = useState(1)

  // Helper: fetch + error text
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

  // Flatten defects
  type FlatDefect = {
    id: number
    description?: string | null
    resolved: boolean
    resolved_at?: string | null
    _reported_at: string
    _report_id: number
    notes?: Array<{ id:number; text:string; created_at:string; author?:{ name?:string } }>
  }
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
    setActivePage(1)
  }

  // Inline add note for an existing defect
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

  // Anyone can add service (per your last call)
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
    <main className="p-4 space-y-4">
      <div>
        <Link href="/trucks" className="text-xs underline">&larr; Back to trucks</Link>
      </div>

      {/* Truck header / errors */}
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-semibold">
          {truck ? <>Truck #{truck.number}</> : 'Truck'}
        </h1>
        {truckErr && <span className="text-xs text-red-600">({truckErr})</span>}
      </div>

      {/* PM snapshot + error */}
      {pm && (
        <div className="border rounded-xl p-3">
          <div className="font-semibold text-sm">PM Status</div>
          <div className="text-sm">Odometer: {fmtNum(pm.odometer)} mi</div>
          <div className="text-sm">Oil next due: {fmtNum(pm.oil_next_due)} (in {fmtNum(pm.oil_miles_remaining)} mi)</div>
          <div className="text-sm">Chassis next due: {fmtNum(pm.chassis_next_due)} (in {fmtNum(pm.chassis_miles_remaining)} mi)</div>
        </div>
      )}
      {pmErr && <div className="text-xs text-red-600">PM: {pmErr}</div>}

      {/* Add Issue */}
      <section className="border rounded-xl p-3 space-y-2">
        <div className="font-semibold text-sm">Add Issue</div>
        <form onSubmit={addIssueWithPhotos} className="grid md:grid-cols-6 gap-2">
          <input
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="Describe the issue"
            className="border px-2 py-1 text-sm rounded-lg md:col-span-3"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="border px-2 py-1 text-sm rounded-lg md:col-span-2"
            onChange={(e) => setFiles(e.currentTarget.files)}
          />
          <button className="border rounded-lg px-2 py-1 text-xs">Add Issue</button>
        </form>
        <div className="grid md:grid-cols-6 gap-2">
          <input
            value={issueNote}
            onChange={(e) => setIssueNote(e.target.value)}
            placeholder="Add a note (optional)"
            className="border px-2 py-1 text-sm rounded-lg md:col-span-5"
          />
          <button className="border rounded-lg px-2 py-1 text-xs" onClick={addIssueWithPhotos}>
            Save with Note
          </button>
        </div>
      </section>

      {/* Active Issues */}
      <section className="border rounded-xl overflow-hidden">
        <div className="p-3 font-semibold text-sm border-b flex items-center justify-between">
          <span>Active Issues</span>
          <span className="text-xs text-gray-500">
            {reportsErr ? <span className="text-red-600">{reportsErr}</span> : `${activeIssues.length} total`}
          </span>
        </div>

        {activeIssues.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">No active issues.</div>
        ) : (
          <>
            <div className="divide-y">
              {activeSlice.map(i => (
                <div key={i.id} className="p-3 text-sm space-y-2">
                  <div className="font-medium">{i.description || '(no description)'}</div>
                  <div className="text-xs text-gray-600">Reported {fmtDate(i._reported_at)}</div>

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

            <div className="flex items-center justify-between p-3 text-xs">
              <span>Page {activePage} of {activeTotalPages}</span>
              <div className="space-x-2">
                <button
                  className="border rounded px-2 py-1 disabled:opacity-50"
                  disabled={activePage <= 1}
                  onClick={() => setActivePage(p => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  className="border rounded px-2 py-1 disabled:opacity-50"
                  disabled={activePage >= activeTotalPages}
                  onClick={() => setActivePage(p => Math.min(activeTotalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Resolved Issues */}
      <section className="border rounded-xl overflow-hidden">
        <div className="p-3 font-semibold text-sm border-b flex items-center justify-between">
          <span>Resolved Issues</span>
          <span className="text-xs text-gray-500">
            {reportsErr ? <span className="text-red-600">{reportsErr}</span> : `${resolvedIssues.length} total`}
          </span>
        </div>

        {resolvedIssues.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">No resolved issues yet.</div>
        ) : (
          <>
            <div className="divide-y">
              {resolvedSlice.map(i => (
                <div key={i.id} className="p-3 text-sm space-y-2">
                  <div className="font-medium">{i.description || '(no description)'}</div>
                  <div className="text-xs text-gray-600">
                    Reported {fmtDate(i._reported_at)} · Resolved {i.resolved_at ? fmtDate(i.resolved_at) : '(date not recorded)'}
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

            <div className="flex items-center justify-between p-3 text-xs">
              <span>Page {resolvedPage} of {resolvedTotalPages}</span>
              <div className="space-x-2">
                <button
                  className="border rounded px-2 py-1 disabled:opacity-50"
                  disabled={resolvedPage <= 1}
                  onClick={() => setResolvedPage(p => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  className="border rounded px-2 py-1 disabled:opacity-50"
                  disabled={resolvedPage >= resolvedTotalPages}
                  onClick={() => setResolvedPage(p => Math.min(resolvedTotalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Add Service — anyone can add */}
      <section className="border rounded-xl p-3">
        <div className="font-semibold text-sm mb-2">Add Service</div>
        <form onSubmit={addService} className="grid md:grid-cols-3 gap-2">
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
    </main>
  )
}
