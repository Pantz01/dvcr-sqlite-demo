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

type Photo = {
  id: number
  path: string
  caption?: string | null
}

type Defect = {
  id: number
  component: string
  severity: string
  description?: string | null
  x?: number | null
  y?: number | null
  resolved: boolean
  photos: Photo[]
}

type Report = {
  id: number
  created_at: string
  odometer?: number | null
  status: string
  summary?: string | null
  type: 'pre' | 'post'
  defects?: Defect[]
  notes?: { id: number; text: string; created_at: string; author: { name: string } }[]
}

export default function TruckPage() {
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
  const [activeReport, setActiveReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // create report form
  const [rType, setRType] = useState<'pre' | 'post'>('pre')
  const [rOdo, setROdo] = useState<number>(0)
  const [rSummary, setRSummary] = useState('')

  // note form
  const [note, setNote] = useState('')

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
    const list: Report[] = await r.json()
    setReports(list)
    // prefer the most recent OPEN report
    const open = list.find(x => x.status === 'OPEN') || list[0] || null
    if (open) {
      // hydrate full report (defects/notes)
      const rr = await fetch(`${API}/reports/${open.id}`, { headers: authHeaders() })
      if (rr.ok) setActiveReport(await rr.json())
      else setActiveReport(open)
    } else {
      setActiveReport(null)
    }
  }

  async function createReport() {
    if (!truck) return
    setBusy(true)
    const r = await fetch(`${API}/trucks/${truck.id}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ type: rType, odometer: rOdo, summary: rSummary }),
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
    setRSummary('')
    await loadTruck()
    await loadReports()
  }

  async function reloadActiveReport() {
    if (!activeReport) return
    const rr = await fetch(`${API}/reports/${activeReport.id}`, { headers: authHeaders() })
    if (rr.ok) {
      const full = await rr.json()
      setActiveReport(full)
      setReports(prev => prev.map(x => x.id === full.id ? full : x))
    }
  }

  // update report fields (odometer/summary/status)
  async function updateReportField(patch: Partial<Pick<Report, 'odometer' | 'summary' | 'status'>>) {
    if (!activeReport) return
    const r = await fetch(`${API}/reports/${activeReport.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(patch),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadActiveReport()
  }

  // clicking the diagram → add defect with normalized x/y
  async function onImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!activeReport) {
      alert('Create/select a report first.')
      return
    }
    const target = e.currentTarget.querySelector('img') as HTMLImageElement | null
    if (!target) return
    const rect = target.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    const description = prompt('Describe the issue:') || ''
    if (!description.trim()) return

    const payload = { component: 'general', severity: 'minor', description, x, y }
    const r = await fetch(`${API}/reports/${activeReport.id}/defects`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadActiveReport()
  }

  // defect actions
  async function toggleDefectResolved(d: Defect) {
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ resolved: !d.resolved }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadActiveReport()
  }

  async function editDefectDescription(d: Defect) {
    const next = prompt('Update description:', d.description || '') ?? ''
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ description: next }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadActiveReport()
  }

  // notes
  async function addNote() {
    if (!activeReport) return
    if (!note.trim()) return
    const r = await fetch(`${API}/reports/${activeReport.id}/notes`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ text: note.trim() }),
    })
    if (!r.ok) { alert(await r.text()); return }
    setNote('')
    await reloadActiveReport()
  }

  const defects = useMemo(() => activeReport?.defects || [], [activeReport])

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">
        {truck ? `Truck ${truck.number}` : 'Truck'}
      </h1>

      {/* Create / select report */}
      <div className="border rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Pre/Post Trip Report</div>
        {!activeReport ? (
          <div className="grid sm:grid-cols-5 gap-2">
            <select
              className="border p-2 rounded-xl"
              value={rType}
              onChange={(e) => setRType(e.target.value as 'pre' | 'post')}
            >
              <option value="pre">pre</option>
              <option value="post">post</option>
            </select>

            <input
              type="number"
              className="border p-2 rounded-xl"
              placeholder="Odometer"
              value={rOdo}
              onChange={(e) => setROdo(parseInt(e.target.value || '0', 10))}
            />

            <input
              className="border p-2 rounded-xl sm:col-span-2"
              placeholder="Summary (optional)"
              value={rSummary}
              onChange={(e) => setRSummary(e.target.value)}
            />

            <button className="border rounded-xl p-2" disabled={busy} onClick={createReport}>
              {busy ? 'Creating…' : 'Start report'}
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3 items-end">
            <div className="text-sm text-gray-700">
              Active report: <b>{activeReport.type.toUpperCase()}</b> ·{' '}
              {new Date(activeReport.created_at).toLocaleString()} ·{' '}
              Odo{' '}
              <input
                type="number"
                defaultValue={activeReport.odometer ?? 0}
                className="border rounded px-2 py-0.5 w-28"
                onBlur={(e) => updateReportField({ odometer: parseInt(e.target.value || '0', 10) })}
              />{' '}
              · Status <b>{activeReport.status}</b>
              <div className="mt-2">
                <input
                  className="border rounded px-2 py-1 w-full"
                  placeholder="Summary"
                  defaultValue={activeReport.summary ?? ''}
                  onBlur={(e) => updateReportField({ summary: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-2 md:justify-end">
              {activeReport.status !== 'CLOSED' && (
                <button
                  className="border rounded-xl px-3 py-2"
                  onClick={() => updateReportField({ status: 'CLOSED' })}
                >
                  Close report
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Truck diagram & markers */}
      <div className="border rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Tap problem areas on the truck</div>
        <div
          className="relative w-full max-w-[720px] aspect-[16/9] border rounded-xl overflow-hidden bg-white"
          onClick={onImageClick}
          title={activeReport ? 'Click to add a defect' : 'Create a report first'}
          style={{ cursor: activeReport ? 'crosshair' as const : 'not-allowed' as const }}
        >
          {/* Ensure this file exists at frontend/public/bobtail.png */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bobtail.png"
            alt="Bobtail"
            className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
            draggable={false}
          />

          {/* markers */}
          {defects.map((d) => {
            if (typeof d.x !== 'number' || typeof d.y !== 'number') return null
            const left = `${d.x * 100}%`
            const top = `${d.y * 100}%`
            return (
              <div
                key={d.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left, top }}
                title={d.description || d.component}
              >
                <span className="block w-3 h-3 rounded-full bg-red-600 ring-2 ring-white shadow" />
              </div>
            )
          })}
        </div>

        {/* Defects list with edit/resolve */}
        <div className="rounded-xl border divide-y">
          <div className="p-3 font-semibold">Defects</div>
          {(defects.length === 0) && (
            <div className="p-3 text-sm text-gray-500">No defects yet.</div>
          )}
          {defects.map(d => (
            <div key={d.id} className="p-3 flex items-center gap-3 text-sm">
              <div className="flex-1">
                <div className="font-medium">{d.description || '(no description)'}</div>
                <div className="text-xs text-gray-600">
                  {d.component} · {d.severity} · {d.resolved ? 'Resolved' : 'Open'}
                </div>
              </div>
              <button className="text-xs underline" onClick={() => editDefectDescription(d)}>Edit</button>
              <button className="text-xs underline" onClick={() => toggleDefectResolved(d)}>
                {d.resolved ? 'Reopen' : 'Resolve'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="border rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Notes</div>
        {activeReport ? (
          <>
            <div className="grid sm:grid-cols-5 gap-2">
              <input
                className="border p-2 rounded-xl sm:col-span-4"
                placeholder="Add a note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className="border rounded-xl p-2" onClick={addNote}>Post</button>
            </div>

            <div className="divide-y rounded-xl border mt-2">
              {(activeReport.notes ?? []).map(n => (
                <div key={n.id} className="p-3 text-sm">
                  <div className="text-gray-600 text-xs">
                    {new Date(n.created_at).toLocaleString()} · {n.author?.name || '—'}
                  </div>
                  <div>{n.text}</div>
                </div>
              ))}
              {(activeReport.notes ?? []).length === 0 && (
                <div className="p-3 text-sm text-gray-500">No notes yet.</div>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-500">Create a report first.</div>
        )}
      </div>

      {/* Existing reports list */}
      <div className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b">Previous Reports</div>
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No reports yet.</div>
        ) : (
          <div className="divide-y">
            {reports.map(r => (
              <button
                key={r.id}
                className={`w-full text-left p-3 hover:bg-gray-50 ${activeReport?.id === r.id ? 'bg-gray-50' : ''}`}
                onClick={async () => {
                  const rr = await fetch(`${API}/reports/${r.id}`, { headers: authHeaders() })
                  if (rr.ok) setActiveReport(await rr.json())
                }}
              >
                <div className="text-sm">
                  {r.type.toUpperCase()} · {new Date(r.created_at).toLocaleString()} · Odo {r.odometer ?? '—'} · {r.status}
                </div>
                {r.summary ? <div className="text-xs text-gray-600">{r.summary}</div> : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
