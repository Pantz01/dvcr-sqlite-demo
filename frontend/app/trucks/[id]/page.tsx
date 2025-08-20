'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { API, jsonHeaders, authHeaders } from '@/lib/api'
import Link from 'next/link'

type Me = { id:number; name:string; email:string; role:'driver'|'mechanic'|'manager'|'admin' }
type Report = {
  id: number
  created_at: string
  defects?: Array<{
    id: number
    description?: string | null
    resolved: boolean
    resolved_at?: string | null
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

export default function TruckDetail() {
  const { id } = useParams() as { id: string }
  const [me, setMe] = useState<Me | null>(null)
  const [truck, setTruck] = useState<any>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [pm, setPm] = useState<any>(null)

  // Add Issue + Photos + optional Note
  const [issue, setIssue] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Pagination (10/page)
  const PAGE_SIZE = 10
  const [activePage, setActivePage] = useState(1)
  const [resolvedPage, setResolvedPage] = useState(1)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const m = await fetch(`${API}/me`, { headers: authHeaders() })
        if (m.ok && !cancelled) setMe(await m.json())

        const t = await fetch(`${API}/trucks/${id}`, { headers: authHeaders() })
        if (t.ok && !cancelled) setTruck(await t.json())

        const r = await fetch(`${API}/trucks/${id}/reports?limit=2000`, { headers: authHeaders() })
        if (r.ok && !cancelled) setReports(await r.json())

        const p = await fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() })
        if (p.ok && !cancelled) setPm(await p.json())
      } catch {}
    })()
    return () => { cancelled = true }
  }, [id])

  // Flatten all defects from all reports so we can paginate/split by status
  type FlatDefect = {
    id: number
    description?: string | null
    resolved: boolean
    resolved_at?: string | null
    _reported_at: string
    _report_id: number
  }

  const allIssues: FlatDefect[] = useMemo(() => {
    const rows: FlatDefect[] = []
    for (const r of reports) {
      const ds = r.defects || []
      for (const d of ds) {
        rows.push({
          id: d.id,
          description: d.description ?? '',
          resolved: d.resolved,
          resolved_at: d.resolved_at ?? null,
          _reported_at: r.created_at,
          _report_id: r.id,
        })
      }
    }
    // newest first (by reported date)
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
    const open = reports.find(r => r && (r as any).status === 'OPEN')
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
    if (!r.ok) { alert(await r.text().catch(()=>'Failed to create report')); return null }
    const created = await r.json()
    setReports(prev => [created as Report, ...prev])
    return created as Report
  }

  // Create issue (+ photos) and optional note attached to the new defect
  async function addIssueWithPhotos(e: React.FormEvent) {
    e.preventDefault()
    const text = issue.trim()
    const noteText = note.trim()
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
      if (!r3.ok) { alert(await r3.text().catch(()=> 'Failed to add note')); /* continue */ }
    }

    // cleanup
    setIssue('')
    setNote('')
    setFiles(null)
    if (fileRef.current) fileRef.current.value = ''
    await refreshData()
    setActivePage(1) // jump to first page so the new issue is visible
  }

  async function addService(e:any) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const body = Object.fromEntries(Array.from(fd.entries())) as any
    const r = await fetch(`${API}/trucks/${id}/service`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ service_type: body.service_type, odometer: Number(body.odometer || 0) })
    })
    if (!r.ok) { alert(await r.text().catch(()=> 'Failed to save service')); return }
    setPm(await r.json())
    e.currentTarget.reset()
  }

  if (!truck) return <main className="p-4 text-sm">Loading…</main>
  const canAddService = me?.role === 'manager' || me?.role === 'admin'

  return (
    <main className="p-4 space-y-4">
      <div>
        <Link href="/trucks" className="text-xs underline">&larr; Back to trucks</Link>
      </div>

      <h1 className="text-xl font-semibold">Truck #{truck.number}</h1>

      {pm && (
        <div className="border rounded-xl p-3">
          <div className="font-semibold text-sm">PM Status</div>
          <div className="text-sm">Odometer: {fmtNum(pm.odometer)} mi</div>
          <div className="text-sm">Oil next due: {fmtNum(pm.oil_next_due)} (in {fmtNum(pm.oil_miles_remaining)} mi)</div>
          <div className="text-sm">Chassis next due: {fmtNum(pm.chassis_next_due)} (in {fmtNum(pm.chassis_miles_remaining)} mi)</div>
        </div>
      )}

      {/* Add Issue (compact) */}
      <form onSubmit={addIssueWithPhotos} className="border rounded-xl p-3 space-y-2">
        <div className="font-semibold text-sm">Add Issue</div>
        <div className="grid md:grid-cols-6 gap-2">
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
        </div>
        <div className="grid md:grid-cols-6 gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note (optional)"
            className="border px-2 py-1 text-sm rounded-lg md:col-span-5"
          />
          <button className="border rounded-lg px-2 py-1 text-xs" onClick={addIssueWithPhotos}>
            Save with Note
          </button>
        </div>
      </form>

      {/* Active Issues (paginated) */}
      <section className="border rounded-xl overflow-hidden">
        <div className="p-3 font-semibold text-sm border-b flex items-center justify-between">
          <span>Active Issues</span>
          <span className="text-xs text-gray-500">{activeIssues.length} total</span>
        </div>

        {activeIssues.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">No active issues.</div>
        ) : (
          <>
            <div className="divide-y">
              {activeSlice.map(i => (
                <div key={i.id} className="p-3 text-sm">
                  <div className="font-medium">{i.description || '(no description)'}</div>
                  <div className="text-xs text-gray-600">Reported {fmtDate(i._reported_at)}</div>
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

      {/* Resolved Issues (separate area + paginated) */}
      <section className="border rounded-xl overflow-hidden">
        <div className="p-3 font-semibold text-sm border-b flex items-center justify-between">
          <span>Resolved Issues</span>
          <span className="text-xs text-gray-500">{resolvedIssues.length} total</span>
        </div>

        {resolvedIssues.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">No resolved issues yet.</div>
        ) : (
          <>
            <div className="divide-y">
              {resolvedSlice.map(i => (
                <div key={i.id} className="p-3 text-sm">
                  <div className="font-medium">{i.description || '(no description)'}</div>
                  <div className="text-xs text-gray-600">
                    Reported {fmtDate(i._reported_at)} · Resolved {i.resolved_at ? fmtDate(i.resolved_at) : '(date not recorded)'}
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

      {/* Add Service — compact & role-gated */}
      {canAddService && (
        <form onSubmit={addService} className="grid md:grid-cols-3 gap-2 border rounded-xl p-3">
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
      )}
    </main>
  )
}
