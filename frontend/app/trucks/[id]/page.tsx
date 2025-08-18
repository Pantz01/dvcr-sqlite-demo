'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { API, jsonHeaders, authHeaders } from '@/lib/api'
import Link from 'next/link' // ← keep

export default function TruckDetail() {
  const { id } = useParams() as { id: string }
  const [truck, setTruck] = useState<any>(null)
  const [reports, setReports] = useState<any[]>([])
  const [pm, setPm] = useState<any>(null)

  // ↓↓↓ added state for issue + photos (keep)
  const [issue, setIssue] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // NEW: safe number formatter (prevents toLocaleString crashes)
  const fmt = (v: any) => {
    const n = Number(v)
    return Number.isFinite(n) ? n.toLocaleString() : (v ?? '—')
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Truck
        const t = await fetch(`${API}/trucks/${id}`, { headers: authHeaders() })
        if (t.ok) {
          const data = await t.json()
          if (!cancelled) setTruck(data)
        } else {
          console.error('truck fetch failed', t.status)
          if (!cancelled) setTruck(null)
        }

        // Reports
        const r = await fetch(`${API}/trucks/${id}/reports`, { headers: authHeaders() })
        if (r.ok) {
          const data = await r.json()
          if (!cancelled) setReports(Array.isArray(data) ? data : [])
        } else {
          console.error('reports fetch failed', r.status)
          if (!cancelled) setReports([])
        }

        // PM
        const p = await fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() })
        if (p.ok) {
          const data = await p.json()
          if (!cancelled) setPm(data)
        } else {
          console.error('pm fetch failed', p.status)
          if (!cancelled) setPm(null)
        }
      } catch (err) {
        console.error('load error', err)
        // don’t throw — just leave current state so the page still renders
      }
    })()
    return () => { cancelled = true }
  }, [id])

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

  // ↓↓↓ ensure there’s an OPEN report (keep)
  async function ensureOpenReport(): Promise<any | null> {
    const open = reports.find(r => r.status === 'OPEN')
    if (open) return open
    const r = await fetch(`${API}/trucks/${id}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        odometer: Number(truck?.odometer || 0),
        summary: '',
        type: 'pre'
      })
    })
    if (!r.ok) { alert(await r.text().catch(()=> 'Failed to create report')); return null }
    const created = await r.json()
    setReports(prev => [created, ...prev])
    return created
  }

  // ↓↓↓ add defect + optional photos (keep)
  async function addIssueWithPhotos(e: React.FormEvent) {
    e.preventDefault()
    const text = issue.trim()
    if (!text && !files?.length) return
    const rep = await ensureOpenReport()
    if (!rep) return

    // 1) create defect
    const r1 = await fetch(`${API}/reports/${rep.id}/defects`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ component: 'general', severity: 'minor', description: text })
    })
    if (!r1.ok) { alert(await r1.text().catch(()=> 'Failed to add issue')); return }
    const defect = await r1.json()

    // 2) upload photos if any
    if (files && files.length > 0) {
      const fd = new FormData()
      Array.from(files).forEach(f => fd.append('files', f))
      const r2 = await fetch(`${API}/defects/${defect.id}/photos`, {
        method: 'POST',
        headers: authHeaders(), // let the browser set multipart boundary
        body: fd
      })
      if (!r2.ok) { alert(await r2.text().catch(()=> 'Failed to upload photos')); return }
    }

    // cleanup + refresh
    setIssue('')
    setFiles(null)
    if (fileRef.current) fileRef.current.value = ''
    // refresh reports list
    try {
      const rr = await fetch(`${API}/trucks/${id}/reports`, { headers: authHeaders() })
      if (rr.ok) setReports(await rr.json())
    } catch {}
    // refresh PM
    try {
      const pp = await fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() })
      if (pp.ok) setPm(await pp.json())
    } catch {}
  }

  if (!truck) return <main className="p-6">Loading…</main>

  return (
    <main className="p-6 space-y-6">
      {/* back link */}
      <div>
        <Link href="/trucks" className="text-sm underline">&larr; Back to trucks</Link>
      </div>

      <h1 className="text-2xl font-bold">Truck #{truck.number}</h1>

      {pm && (
        <div className="border rounded-2xl p-3">
          <div className="font-semibold">PM Status</div>
          <div className="text-sm">Odometer: {fmt(pm.odometer)} mi</div>
          <div className="text-sm">Oil next due: {fmt(pm.oil_next_due)} (in {fmt(pm.oil_miles_remaining)} mi)</div>
          <div className="text-sm">Chassis next due: {fmt(pm.chassis_next_due)} (in {fmt(pm.chassis_miles_remaining)} mi)</div>
        </div>
      )}

      {/* Removed: New Report pre/post form in your latest flow */}

      {/* quick “Add Issue + Photos” */}
      <form onSubmit={addIssueWithPhotos} className="grid md:grid-cols-6 gap-2 border rounded-2xl p-4">
        <input
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          placeholder="Describe the issue (e.g., brake light out)"
          className="border p-2 rounded-xl md:col-span-3"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="border p-2 rounded-xl md:col-span-2"
          onChange={(e) => setFiles(e.currentTarget.files)}
        />
        <button className="border rounded-2xl p-2">Add Issue</button>
      </form>

      <form onSubmit={addService} className="grid md:grid-cols-3 gap-2 border rounded-2xl p-4">
        <select name="service_type" className="border p-2 rounded-xl">
          <option value="oil">Oil change</option>
          <option value="chassis">Chassis lube</option>
        </select>
        <input name="odometer" placeholder="Odometer" className="border p-2 rounded-xl" required/>
        <button className="border rounded-2xl p-2">Log service</button>
      </form>

      <div className="space-y-2">
        <div className="p-3 font-semibold">Previous issues</div>
        {reports.map((r: any) => {
          const defects = Array.isArray(r.defects) ? r.defects : []
          const openCount = defects.filter((d: any) => !d.resolved).length
          const resolvedCount = defects.filter((d: any) => d.resolved).length
          const statusText = openCount > 0 ? 'Unresolved' : 'Resolved'

          return (
            <a
              key={r.id}
              href={`/reports/${r.id}`}
              className="block p-3 rounded-xl border hover:bg-gray-50"
            >
              <div className="text-sm text-gray-600">
                {new Date(r.created_at).toLocaleString()}
              </div>
              <div className="font-semibold">
                Previous issues — {statusText}
              </div>
              {(openCount + resolvedCount) > 0 && (
                <div className="text-xs text-gray-600">
                  {openCount} open / {resolvedCount} resolved
                </div>
              )}
              {r.summary ? <div className="text-sm mt-1">{r.summary}</div> : null}
            </a>
          )
        })}
        {reports.length === 0 && (
          <div className="p-3 text-sm text-gray-500">No previous issues.</div>
        )}
      </div>

    </main>
  )
}
