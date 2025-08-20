'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { API, jsonHeaders, authHeaders } from '@/lib/api'
import Link from 'next/link' // ← keep

type Me = { id: number; name: string; email: string; role: 'driver' | 'mechanic' | 'manager' | 'admin' }

// simple M-D-YYYY formatter (no leading zeros)
function fmtDate(value: string | number | Date) {
  const d = new Date(value)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const y = d.getFullYear()
  return `${m}-${day}-${y}`
}

// safe number formatter (prevents toLocaleString crashes)
const fmtNum = (v: any) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : (v ?? '—')
}

export default function TruckDetail() {
  const { id } = useParams() as { id: string }
  const [me, setMe] = useState<Me | null>(null)
  const [truck, setTruck] = useState<any>(null)
  const [reports, setReports] = useState<any[]>([])
  const [pm, setPm] = useState<any>(null)

  // ↓↓↓ added state for issue + photos (keep)
  const [issue, setIssue] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Me (for role-gating Add Service UI)
        const m = await fetch(`${API}/me`, { headers: authHeaders() })
        if (m.ok) {
          const data = await m.json()
          if (!cancelled) setMe(data)
        }

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

  // ↓↓↓ add defect + optional photos (keep) — compact UI controls below
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
    try {
      const rr = await fetch(`${API}/trucks/${id}/reports`, { headers: authHeaders() })
      if (rr.ok) setReports(await rr.json())
    } catch {}
    try {
      const pp = await fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() })
      if (pp.ok) setPm(await pp.json())
    } catch {}
  }

  if (!truck) return <main className="p-4 text-sm">Loading…</main>

  const canAddService = me?.role === 'manager' || me?.role === 'admin' // UI gate (server still enforces)

  return (
    <main className="p-4 space-y-4">
      {/* back link */}
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

      {/* Quick “Add Issue + Photos” — compact */}
      <form onSubmit={addIssueWithPhotos} className="grid md:grid-cols-6 gap-2 border rounded-xl p-3">
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

      {/* Add Service — compact & only visible to manager/admin */}
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

      <div className="space-y-2">
        <div className="p-2 font-semibold text-sm">Previous issues</div>
        {reports.map((r: any) => {
          const defects = Array.isArray(r.defects) ? r.defects : []
          const openCount = defects.filter((d: any) => !d.resolved).length
          const resolvedCount = defects.filter((d: any) => d.resolved).length
          const statusText = openCount > 0 ? 'Unresolved' : 'Resolved'

          return (
            <a
              key={r.id}
              href={`/reports/${r.id}`}
              className="block p-3 rounded-lg border hover:bg-gray-50"
            >
              {/* date only, no time */}
              <div className="text-xs text-gray-600">{fmtDate(r.created_at)}</div>
              <div className="font-medium">
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
