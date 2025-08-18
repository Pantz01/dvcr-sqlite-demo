'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { API, jsonHeaders, authHeaders } from '@/lib/api'
import Link from 'next/link' // ← added

export default function TruckDetail() {
  const { id } = useParams() as { id: string }
  const [truck, setTruck] = useState<any>(null)
  const [reports, setReports] = useState<any[]>([])
  const [pm, setPm] = useState<any>(null)

  // ↓↓↓ added state for issue + photos
  const [issue, setIssue] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    fetch(`${API}/trucks/${id}`, { headers: authHeaders() }).then(r=>r.json()).then(setTruck)
    fetch(`${API}/trucks/${id}/reports`, { headers: authHeaders() }).then(r=>r.json()).then(setReports)
    fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() }).then(r=>r.json()).then(setPm)
  }, [id])

  async function createReport(formData: FormData) {
    const body = Object.fromEntries(Array.from(formData.entries())) as any
    const r = await fetch(`${API}/trucks/${id}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        odometer: Number(body.odometer || 0),
        summary: body.summary,
        type: body.type || 'pre'
      })
    })
    if (!r.ok) { alert(await r.text()); return }
    const created = await r.json()
    setReports([created, ...reports])
    // refresh PM box if odometer advanced
    fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() }).then(x=>x.json()).then(setPm)
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
    if (!r.ok) { alert(await r.text()); return }
    setPm(await r.json())
    e.currentTarget.reset()
  }

  // ↓↓↓ ensure there’s an OPEN report (added)
  async function ensureOpenReport(): Promise<any | null> {
    const open = reports.find(r => r.status === 'OPEN')
    if (open) return open
    // create a minimal new report (pre-trip)
    const r = await fetch(`${API}/trucks/${id}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        odometer: Number(truck?.odometer || 0),
        summary: '',
        type: 'pre'
      })
    })
    if (!r.ok) { alert(await r.text()); return null }
    const created = await r.json()
    setReports(prev => [created, ...prev])
    return created
  }

  // ↓↓↓ add defect + optional photos (added)
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
    if (!r1.ok) { alert(await r1.text()); return }
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
      if (!r2.ok) { alert(await r2.text()); return }
    }

    // cleanup + refresh
    setIssue('')
    setFiles(null)
    if (fileRef.current) fileRef.current.value = ''
    // refresh reports list so newest OPEN is at top (optional simple refresh)
    fetch(`${API}/trucks/${id}/reports`, { headers: authHeaders() }).then(r=>r.json()).then(setReports)
    // refresh PM in case odometer changed elsewhere
    fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() }).then(x=>x.json()).then(setPm)
  }

  if (!truck) return <main className="p-6">Loading…</main>

  return (
    <main className="p-6 space-y-6">
      {/* ← added back link */}
      <div>
        <Link href="/trucks" className="text-sm underline">&larr; Back to trucks</Link>
      </div>

      <h1 className="text-2xl font-bold">Truck #{truck.number}</h1>

      {pm && (
        <div className="border rounded-2xl p-3">
          <div className="font-semibold">PM Status</div>
          <div className="text-sm">Odometer: {pm.odometer?.toLocaleString?.() ?? pm.odometer} mi</div>
          <div className="text-sm">Oil next due: {pm.oil_next_due.toLocaleString()} (in {pm.oil_miles_remaining.toLocaleString()} mi)</div>
          <div className="text-sm">Chassis next due: {pm.chassis_next_due.toLocaleString()} (in {pm.chassis_miles_remaining.toLocaleString()} mi)</div>
        </div>
      )}

      <form action={createReport} className="grid md:grid-cols-4 gap-2 border rounded-2xl p-4">
        <input name="odometer" placeholder="Odometer" className="border p-2 rounded-xl"/>
        <select name="type" className="border p-2 rounded-xl">
          <option value="pre">Pre-trip</option>
          <option value="post">Post-trip</option>
        </select>
        <input name="summary" placeholder="Summary (optional)" className="border p-2 rounded-xl md:col-span-1"/>
        <button className="border rounded-2xl p-2">New Report</button>
      </form>

      {/* ↓↓↓ added: quick “Add Issue + Photos” for this truck */}
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
        {reports.map(r => (
          <a key={r.id} href={`/reports/${r.id}`} className="block p-3 rounded-xl border hover:bg-gray-50">
            <div className="text-sm text-gray-600">{new Date(r.created_at).toLocaleString()}</div>
            <div className="font-semibold">{r.type?.toUpperCase()} — Odo {r.odometer ?? '—'}</div>
            <div className="text-sm">{r.summary}</div>
          </a>
        ))}
      </div>
    </main>
  )
}
