'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

type Photo = {
  id: number
  path: string
  caption?: string | null
}

type Defect = {
  id: number
  description?: string | null
  resolved: boolean
  photos?: Photo[]
}

export default function TruckDetail() {
  const { id } = useParams() as { id: string }
  const router = useRouter()

  const [truck, setTruck] = useState<any>(null)
  const [reports, setReports] = useState<any[]>([])
  const [activeReport, setActiveReport] = useState<any | null>(null)
  const [pm, setPm] = useState<any>(null)

  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const [odo, setOdo] = useState<number>(0)

  // photos for new issue
  const [issueFiles, setIssueFiles] = useState<FileList | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function reloadBasics() {
    fetch(`${API}/trucks/${id}`, { headers: authHeaders() })
      .then(r=>r.json()).then((t) => { setTruck(t); setOdo(t?.odometer ?? 0) })
    fetch(`${API}/trucks/${id}/reports?limit=25`, { headers: authHeaders() })
      .then(r=>r.json()).then(async (list) => {
        setReports(list || [])
        const open = (list || []).find((x:any) => x.status === 'OPEN') || (list || [])[0] || null
        if (open) {
          const rr = await fetch(`${API}/reports/${open.id}`, { headers: authHeaders() })
          setActiveReport(rr.ok ? await rr.json() : open)
        } else {
          setActiveReport(null)
        }
      })
    fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() })
      .then(r=>r.json()).then(setPm)
  }

  useEffect(reloadBasics, [id])

  async function ensureReport(): Promise<any | null> {
    if (activeReport) return activeReport
    // create a minimal report when posting an issue/odometer
    setBusy(true)
    const r = await fetch(`${API}/trucks/${id}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ type: 'pre', odometer: odo, summary: '' }),
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return null }
    const created = await r.json()
    const rr = await fetch(`${API}/reports/${created.id}`, { headers: authHeaders() })
    const full = rr.ok ? await rr.json() : created
    setActiveReport(full)
    setReports(prev => [full, ...prev.filter((p:any)=>p.id!==full.id)])
    return full
  }

  async function saveOdometer() {
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
    // refresh PM + report
    fetch(`${API}/trucks/${id}/pm-next`, { headers: authHeaders() }).then(x=>x.json()).then(setPm)
    await reloadActiveReport(rep.id)
  }

  async function uploadDefectPhotos(defectId: number, files: FileList) {
    const fd = new FormData()
    Array.from(files).forEach(f => fd.append('files', f))
    const r = await fetch(`${API}/defects/${defectId}/photos`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    })
    if (!r.ok) throw new Error(await r.text())
  }

  async function addIssue() {
    const text = issue.trim()
    if (!text && !issueFiles?.length) return
    const rep = await ensureReport()
    if (!rep) return
    try {
      setBusy(true)

      // try combined endpoint if present
      if (issueFiles && issueFiles.length > 0) {
        const fd = new FormData()
        fd.append('component', 'general')
        fd.append('severity', 'minor')
        if (text) fd.append('description', text)
        Array.from(issueFiles).forEach(f => fd.append('files', f))
        const r = await fetch(`${API}/reports/${rep.id}/defects-with-photos`, {
          method: 'POST',
          headers: authHeaders(),
          body: fd,
        })
        if (r.ok) {
          setIssue(''); setIssueFiles(null); if (fileRef.current) fileRef.current.value = ''
          await reloadActiveReport(rep.id)
          setBusy(false)
          return
        }
      }

      // fallback two-step
      const r1 = await fetch(`${API}/reports/${rep.id}/defects`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ component: 'general', severity: 'minor', description: text }),
      })
      if (!r1.ok) throw new Error(await r1.text())
      const defect = await r1.json()
      if (issueFiles && issueFiles.length > 0) {
        await uploadDefectPhotos(defect.id, issueFiles)
      }
      setIssue(''); setIssueFiles(null); if (fileRef.current) fileRef.current.value = ''
      await reloadActiveReport(rep.id)
    } catch (err:any) {
      alert(err?.message || 'Failed to add issue')
    } finally {
      setBusy(false)
    }
  }

  async function reloadActiveReport(reportId: number) {
    const rr = await fetch(`${API}/reports/${reportId}`, { headers: authHeaders() })
    if (!rr.ok) return
    const full = await rr.json()
    setActiveReport(full)
    setReports(prev => prev.map((p:any)=>p.id===full.id ? full : p))
  }

  async function loadReport(reportId: number) {
    const rr = await fetch(`${API}/reports/${reportId}`, { headers: authHeaders() })
    if (!rr.ok) { alert(await rr.text()); return }
    setActiveReport(await rr.json())
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

  if (!truck) return <main className="p-6">Loading…</main>

  const defects = useMemo(() => activeReport?.defects || [], [activeReport])

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <button className="text-sm underline" onClick={()=>router.push('/trucks')}>&larr; Back to list</button>
        <Link href={`/reports/${activeReport?.id ?? ''}`} className="text-sm underline">
          View report
        </Link>
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

      {/* Odometer quick-save (kept) */}
      <div className="grid md:grid-cols-3 gap-2 border rounded-2xl p-4 items-end">
        <label className="grid gap-1 text-sm">
          <span className="text-gray-600">Odometer</span>
          <input
            name="odometer"
            placeholder="Odometer"
            className="border p-2 rounded-xl"
            value={odo}
            onChange={(e)=>setOdo(parseInt(e.target.value || '0', 10))}
          />
        </label>
        <div />
        <button className="border rounded-2xl p-2" onClick={saveOdometer} disabled={busy}>
          {busy ? 'Saving…' : 'Save Odometer'}
        </button>
      </div>

      {/* ADD ISSUE (kept) */}
      <section className="grid md:grid-cols-6 gap-2 border rounded-2xl p-4 items-center">
        <input
          className="border p-2 rounded-xl md:col-span-3"
          placeholder="Add an issue (e.g., brake light out)"
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="border p-2 rounded-xl md:col-span-2"
          onChange={(e) => setIssueFiles(e.currentTarget.files)}
          aria-label="Attach photos"
        />
        <button className="border rounded-2xl p-2" onClick={addIssue} disabled={busy}>
          {busy ? 'Adding…' : 'Add issue'}
        </button>
      </section>

      {/* SERVICE LOG (unchanged) */}
      <form onSubmit={addService} className="grid md:grid-cols-3 gap-2 border rounded-2xl p-4">
        <select name="service_type" className="border p-2 rounded-xl">
          <option value="oil">Oil change</option>
          <option value="chassis">Chassis lube</option>
        </select>
        <input name="odometer" placeholder="Odometer" className="border p-2 rounded-xl" required/>
        <button className="border rounded-2xl p-2">Log service</button>
      </form>

      {/* RECENT REPORTS (read-only links) */}
      {reports.length > 0 && (
        <div className="space-y-2">
          <div className="font-semibold">Recent Reports</div>
          {reports.map(r => (
            <a key={r.id} href={`/reports/${r.id}`} className="block p-3 rounded-xl border hover:bg-gray-50">
              <div className="text-sm text-gray-600">{new Date(r.created_at).toLocaleString()}</div>
              <div className="font-semibold">{String(r.type || '').toUpperCase()} — Odo {r.odometer ?? '—'}</div>
              {r.summary ? <div className="text-sm">{r.summary}</div> : null}
            </a>
          ))}
        </div>
      )}
    </main>
  )
}
