'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { API, jsonHeaders, authHeaders } from '@/lib/api'

export default function TruckDetail() {
  const { id } = useParams() as { id: string }
  const [truck, setTruck] = useState<any>(null)
  const [reports, setReports] = useState<any[]>([])
  const [pm, setPm] = useState<any>(null)

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

  if (!truck) return <main className="p-6">Loading…</main>

  return (
    <main className="p-6 space-y-6">
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
