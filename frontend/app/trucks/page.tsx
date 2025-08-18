'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import { API, authHeaders, jsonHeaders } from '@/lib/api'
import Link from 'next/link' // ← added

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
  description?: string | null
  resolved: boolean
  photos?: Photo[] // ← allow photos if backend includes them
}

type Report = {
  id: number
  created_at: string
  odometer?: number | null
  status: 'OPEN' | 'CLOSED' | string
  summary?: string | null
  defects?: Defect[]
}

export default function DriverTrucksPage() {
  return (
    <RequireAuth>
      <DriverTrucksInner />
    </RequireAuth>
  )
}

function DriverTrucksInner() {
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [selected, setSelected] = useState<Truck | null>(null)

  const [reports, setReports] = useState<Report[]>([])
  const [activeReport, setActiveReport] = useState<Report | null>(null)

  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const [odo, setOdo] = useState<number>(0)
  const [issue, setIssue] = useState('')

  // NEW: hold chosen files and a ref to clear the input after upload
  const [issueFiles, setIssueFiles] = useState<FileList | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { loadTrucks() }, [])

  async function loadTrucks() {
    const r = await fetch(`${API}/trucks`, { headers: authHeaders() })
    if (!r.ok) { alert(await r.text()); return }
    setTrucks(await r.json())
  }

  async function selectTruck(t: Truck) {
    setSelected(t)
    setOdo(t.odometer ?? 0)
    setIssue('')
    setIssueFiles(null)
    if (fileRef.current) fileRef.current.value = '' // clear picker
    setActiveReport(null)
    setReports([])
    setLoading(true)

    // Get most recent reports and prefer an OPEN one
    const r = await fetch(`${API}/trucks/${t.id}/reports?limit=25`, { headers: authHeaders() })
    setLoading(false)
    if (!r.ok) { alert(await r.text()); return }
    const list: Report[] = await r.json()
    setReports(list)

    const open = list.find(x => x.status === 'OPEN') || list[0] || null
    if (open) {
      const rr = await fetch(`${API}/reports/${open.id}`, { headers: authHeaders() })
      setActiveReport(rr.ok ? await rr.json() : open)
    }
  }

  // Ensure there is an active/open report to attach updates to
  async function ensureReport(): Promise<Report | null> {
    if (!selected) return null
    if (activeReport) return activeReport
    setBusy(true)
    const r = await fetch(`${API}/trucks/${selected.id}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ type: 'pre', odometer: odo || selected.odometer, summary: '' }),
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return null }
    const created: Report = await r.json()
    // hydrate
    const rr = await fetch(`${API}/reports/${created.id}`, { headers: authHeaders() })
    const full = rr.ok ? await rr.json() : created
    setActiveReport(full)
    // also refresh list so it appears at the top
    setReports(prev => [full, ...prev.filter(p => p.id !== full.id)])
    return full
  }

  // Save odometer on the report (backend already bumps truck.odometer if higher)
  async function saveOdometer() {
    if (!selected) return
    const rep = await ensureReport()
    if (!rep) return
    setBusy(true)
    const r = await fetch(`${API}/reports/${rep.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ odometer: odo }),
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
    await reloadActiveReport(rep.id)
  }

  // Helper: upload photos for a defect (existing endpoint)
  async function uploadDefectPhotos(defectId: number, files: FileList) {
    const fd = new FormData()
    Array.from(files).forEach(f => fd.append('files', f))
    const r = await fetch(`${API}/defects/${defectId}/photos`, {
      method: 'POST',
      headers: authHeaders(), // don't set Content-Type manually
      body: fd,
    })
    if (!r.ok) throw new Error(await r.text())
  }

  // Add issue (defect) with optional photos
  async function addIssue() {
    const text = issue.trim()
    if (!selected || (!text && !issueFiles?.length)) return
    const rep = await ensureReport()
    if (!rep) return

    try {
      setBusy(true)

      // If you added the combined endpoint, try it first
      if (issueFiles && issueFiles.length > 0) {
        const fd = new FormData()
        // required fields for combined endpoint
        fd.append('component', 'general')
        fd.append('severity', 'minor')
        if (text) fd.append('description', text)
        Array.from(issueFiles).forEach(f => fd.append('files', f))

        const tryCombined = await fetch(`${API}/reports/${rep.id}/defects-with-photos`, {
          method: 'POST',
          headers: authHeaders(), // auth only; browser sets multipart boundary
          body: fd,
        })

        if (tryCombined.ok) {
          // success in one call
          setIssue('')
          setIssueFiles(null)
          if (fileRef.current) fileRef.current.value = ''
          await reloadActiveReport(rep.id)
          setBusy(false)
          return
        }
        // If 404/405 etc, fall through to two-step flow
      }

      // Two-step fallback (always works with your existing backend)
      // 1) create defect
      const r1 = await fetch(`${API}/reports/${rep.id}/defects`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ component: 'general', severity: 'minor', description: text }),
      })
      if (!r1.ok) throw new Error(await r1.text())
      const defect = await r1.json()

      // 2) upload photos if any
      if (issueFiles && issueFiles.length > 0) {
        await uploadDefectPhotos(defect.id, issueFiles)
      }

      setIssue('')
      setIssueFiles(null)
      if (fileRef.current) fileRef.current.value = ''
      await reloadActiveReport(rep.id)
    } catch (err: any) {
      alert(err?.message || 'Failed to add issue')
    } finally {
      setBusy(false)
    }
  }

  // Edit / toggle / delete defect
  async function editDefect(d: Defect) {
    const next = prompt('Update issue text:', d.description || '') ?? ''
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ description: next }),
    })
    if (!r.ok) { alert(await r.text()); return }
    if (activeReport) await reloadActiveReport(activeReport.id)
  }

  async function toggleResolved(d: Defect) {
    const r = await fetch(`${API}/defects/${d.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ resolved: !d.resolved }),
    })
    if (!r.ok) { alert(await r.text()); return }
    if (activeReport) await reloadActiveReport(activeReport.id)
  }

  async function deleteDefect(id: number) {
    if (!confirm('Delete this issue?')) return
    const r = await fetch(`${API}/defects/${id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    if (activeReport) await reloadActiveReport(activeReport.id)
  }

  // Switch between previous reports
  async function loadReport(id: number) {
    const rr = await fetch(`${API}/reports/${id}`, { headers: authHeaders() })
    if (!rr.ok) { alert(await rr.text()); return }
    const full = await rr.json()
    setActiveReport(full)
  }

  async function reloadActiveReport(id: number) {
    const rr = await fetch(`${API}/reports/${id}`, { headers: authHeaders() })
    if (!rr.ok) return
    const full = await rr.json()
    setActiveReport(full)
    // also sync row in the list
    setReports(prev => prev.map(p => (p.id === full.id ? full : p)))
  }

  const defects = useMemo(() => activeReport?.defects || [], [activeReport])

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Trucks</h1>

      {/* Truck picker + details */}
      <div className="border rounded-2xl overflow-hidden grid md:grid-cols-3">
        {/* Left: list */}
        <div className="border-r">
          <div className="p-3 font-semibold">Select Truck</div>
          <div className="max-h-[60vh] overflow-auto divide-y">
            {trucks.map(t => (
              <Link
                key={t.id}
                href={`/trucks/${t.id}`}
                className={`block text-left p-3 hover:bg-gray-50 ${selected?.id === t.id ? 'bg-gray-50' : ''}`}
                aria-label={`Open truck ${t.number}`}
              >
                <div className="font-medium">{t.number}</div>
                <div className="text-xs text-gray-600">
                  VIN {t.vin || '—'} · Odo {t.odometer ?? 0} · {t.active ? 'Active' : 'Inactive'}
                </div>
              </Link>
            ))}
            {trucks.length === 0 && <div className="p-3 text-sm text-gray-500">No trucks.</div>}
          </div>
        </div>

        {/* Right: actions */}
        <div className="p-4 md:grid md:col-span-2 space-y-4">
          {!selected ? (
            <div className="text-sm text-gray-500">Choose a truck on the left.</div>
          ) : (
            <>
              {/* Odometer */}
              <div className="grid sm:grid-cols-3 gap-3 items-end">
                <label className="grid gap-1 text-sm">
                  <span className="text-gray-600">Odometer</span>
                  <input
                    type="number"
                    className="border p-2 rounded-xl"
                    value={odo}
                    onChange={(e) => setOdo(parseInt(e.target.value || '0', 10))}
                  />
                </label>
                <button className="border rounded-xl px-3 py-2" disabled={busy} onClick={saveOdometer}>
                  {busy ? 'Saving…' : 'Save odometer'}
                </button>
              </div>

              {/* Add issue + photos */}
              <div className="grid sm:grid-cols-6 gap-2 items-center">
                <input
                  className="border p-2 rounded-xl sm:col-span-3"
                  placeholder="Add an issue (e.g., brake light out)"
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="border p-2 rounded-xl sm:col-span-2"
                  onChange={(e) => setIssueFiles(e.currentTarget.files)}
                  aria-label="Attach photos"
                />
                <button className="border rounded-xl p-2" onClick={addIssue} disabled={busy}>
                  {busy ? 'Adding…' : 'Add issue'}
                </button>
              </div>

              {/* Active report & issues */}
              <div className="rounded-xl border overflow-hidden">
                <div className="p-3 font-semibold border-b">Current Report</div>
                {loading ? (
                  <div className="p-3 text-sm text-gray-500">Loading…</div>
                ) : !activeReport ? (
                  <div className="p-3 text-sm text-gray-500">No report yet. Save odometer or add an issue to start one.</div>
                ) : (
                  <>
                    <div className="p-3 text-sm text-gray-700">
                      Created {new Date(activeReport.created_at).toLocaleString()} · Odo {activeReport.odometer ?? '—'} · {activeReport.status}
                    </div>

                    {defects.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500">No issues listed.</div>
                    ) : (
                      <div className="divide-y">
                        {defects.map(d => (
                          <div key={d.id} className="p-3 text-sm space-y-2">
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <div className="font-medium">{d.description || '(no description)'}</div>
                                <div className="text-xs text-gray-600">{d.resolved ? 'Resolved' : 'Open'}</div>
                              </div>
                              <button className="text-xs underline" onClick={() => editDefect(d)}>Edit</button>
                              <button className="text-xs underline" onClick={() => toggleResolved(d)}>
                                {d.resolved ? 'Reopen' : 'Resolve'}
                              </button>
                              <button className="text-xs underline text-red-600" onClick={() => deleteDefect(d.id)}>
                                Delete
                              </button>
                            </div>

                            {/* Thumbnails if backend returns photos on defects */}
                            {d.photos && d.photos.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {d.photos.map(p => (
                                  <a key={p.id} href={p.path} target="_blank" rel="noreferrer" className="inline-block">
                                    <img
                                      src={p.path}
                                      alt={p.caption || 'defect photo'}
                                      className="h-16 w-16 object-cover rounded-md border"
                                    />
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Previous reports (quick switch) */}
              {reports.length > 0 && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="p-3 font-semibold border-b">Previous Reports</div>
                  <div className="divide-y max-h-[30vh] overflow-auto">
                    {reports.map(r => (
                      <button
                        key={r.id}
                        className={`w-full text-left p-3 hover:bg-gray-50 ${activeReport?.id === r.id ? 'bg-gray-50' : ''}`}
                        onClick={() => loadReport(r.id)}
                      >
                        <div className="text-sm">
                          {new Date(r.created_at).toLocaleString()} · Odo {r.odometer ?? '—'} · {r.status}
                        </div>
                        {r.summary ? <div className="text-xs text-gray-600">{r.summary}</div> : null}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
