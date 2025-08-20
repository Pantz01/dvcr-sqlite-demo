'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { API, jsonHeaders, authHeaders } from '@/lib/api'
import Link from 'next/link'

export default function TruckDetail() {
  const { id } = useParams() as { id: string }
  const [truck, setTruck] = useState<any>(null)
  const [reports, setReports] = useState<any[]>([])
  const [pm, setPm] = useState<any>(null)

  // Issue + files + notes
  const [issue, setIssue] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Pagination
  const [page, setPage] = useState(1)
  const perPage = 10

  const fmt = (v: any) => {
    const n = Number(v)
    return Number.isFinite(n) ? n.toLocaleString() : (v ?? '—')
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [t, r, p] = await Promise.all([
          fetch(`${API}/trucks/${id}`, { headers: authHeaders() }),
          fetch(`${API}/trucks/${id}/reports`, { headers: authHeaders() }),
          fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() })
        ])

        if (!cancelled && t.ok) setTruck(await t.json())
        if (!cancelled && r.ok) setReports(await r.json())
        if (!cancelled && p.ok) setPm(await p.json())
      } catch (err) {
        console.error('load error', err)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  async function addService(e:any) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const body = Object.fromEntries(fd.entries()) as any
    const r = await fetch(`${API}/trucks/${id}/service`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ service_type: body.service_type, odometer: Number(body.odometer || 0) })
    })
    if (!r.ok) { alert(await r.text().catch(()=> 'Failed to save service')); return }
    setPm(await r.json())
    e.currentTarget.reset()
  }

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

  async function addIssueWithPhotos(e: React.FormEvent) {
    e.preventDefault()
    if (!issue.trim() && !note.trim() && !files?.length) return
    const rep = await ensureOpenReport()
    if (!rep) return

    const r1 = await fetch(`${API}/reports/${rep.id}/defects`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ 
        component: 'general', 
        severity: 'minor', 
        description: issue.trim() || note.trim() 
      })
    })
    if (!r1.ok) { alert(await r1.text().catch(()=> 'Failed to add issue')); return }
    const defect = await r1.json()

    if (files && files.length > 0) {
      const fd = new FormData()
      Array.from(files).forEach(f => fd.append('files', f))
      const r2 = await fetch(`${API}/defects/${defect.id}/photos`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd
      })
      if (!r2.ok) { alert(await r2.text().catch(()=> 'Failed to upload photos')); return }
    }

    setIssue('')
    setNote('')
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

  if (!truck) return <main className="p-6">Loading…</main>

  const activeReports = reports.flatMap(r => 
    (r.defects || []).map((d:any) => ({...d, reportId: r.id, created_at: r.created_at}))
  ).filter((d:any) => !d.resolved)

  const resolvedReports = reports.flatMap(r => 
    (r.defects || []).map((d:any) => ({...d, reportId: r.id, created_at: r.created_at}))
  ).filter((d:any) => d.resolved)

  const paginatedActive = activeReports.slice((page-1)*perPage, page*perPage)

  return (
    <main className="p-6 space-y-6">
      <div><Link href="/trucks" className="text-sm underline">&larr; Back to trucks</Link></div>
      <h1 className="text-2xl font-bold">Truck #{truck.number}</h1>

      {pm && (
        <div className="border rounded-xl p-3 text-sm space-y-1">
          <div className="font-semibold">PM Status</div>
          <div>Odometer: {fmt(pm.odometer)} mi</div>
          <div>Oil next due: {fmt(pm.oil_next_due)} (in {fmt(pm.oil_miles_remaining)} mi)</div>
          <div>Chassis next due: {fmt(pm.chassis_next_due)} (in {fmt(pm.chassis_miles_remaining)} mi)</div>
        </div>
      )}

      {/* Add issue + note + photos */}
      <form onSubmit={addIssueWithPhotos} className="grid md:grid-cols-6 gap-2 border rounded-xl p-3 text-sm">
        <input
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          placeholder="Describe issue"
          className="border p-1 rounded col-span-2 text-xs"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add note"
          className="border p-1 rounded col-span-2 text-xs"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="border p-1 rounded col-span-1 text-xs"
          onChange={(e) => setFiles(e.currentTarget.files)}
        />
        <button className="border rounded px-2 py-1 text-xs hover:bg-gray-100">Add</button>
      </form>

      {/* Add service */}
      <form onSubmit={addService} className="grid md:grid-cols-3 gap-2 border rounded-xl p-3 text-sm">
        <select name="service_type" className="border p-1 rounded text-xs">
          <option value="oil">Oil change</option>
          <option value="chassis">Chassis lube</option>
        </select>
        <input name="odometer" placeholder="Odometer" className="border p-1 rounded text-xs" required/>
        <button className="border rounded px-2 py-1 text-xs hover:bg-gray-100">Log</button>
      </form>

      {/* Active Issues */}
      <div className="border rounded-xl p-3 text-sm space-y-2">
        <div className="font-semibold">Active Issues</div>
        {paginatedActive.length === 0 && (
          <div className="text-gray-500">No active issues.</div>
        )}
        {paginatedActive.map((d:any) => (
          <a key={d.id} href={`/reports/${d.reportId}`} className="block border rounded p-2 hover:bg-gray-50">
            <div className="text-xs text-gray-500">{new Date(d.created_at).toLocaleDateString()}</div>
            <div>{d.description}</div>
          </a>
        ))}
        {activeReports.length > perPage && (
          <div className="flex gap-2">
            <button disabled={page===1} onClick={()=>setPage(p=>p-1)} className="px-2 py-1 border rounded text-xs">Prev</button>
            <button disabled={page*perPage>=activeReports.length} onClick={()=>setPage(p=>p+1)} className="px-2 py-1 border rounded text-xs">Next</button>
          </div>
        )}
      </div>

      {/* Resolved Issues */}
      <div className="border rounded-xl p-3 text-sm space-y-2">
        <div className="font-semibold">Resolved Issues</div>
        {resolvedReports.length === 0 && (
          <div className="text-gray-500">No resolved issues.</div>
        )}
        {resolvedReports.map((d:any) => (
          <a key={d.id} href={`/reports/${d.reportId}`} className="block border rounded p-2 hover:bg-gray-50">
            <div className="text-xs text-gray-500">{new Date(d.created_at).toLocaleDateString()}</div>
            <div>{d.description}</div>
          </a>
        ))}
      </div>
    </main>
  )
}
