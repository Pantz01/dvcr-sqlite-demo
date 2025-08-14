const API = process.env.NEXT_PUBLIC_API!;
'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

export default function TruckDetail() {
  const { id } = useParams() as { id: string }
  const [truck, setTruck] = useState<any>(null)
  const [reports, setReports] = useState<any[]>([])
  const uid = typeof window !== 'undefined' ? localStorage.getItem('x-user-id') : null

  useEffect(() => {
    fetch(`${API}/trucks/${id}`).then(r=>r.json()).then(setTruck)
    fetch(`${API}/trucks/${id}/reports`).then(r=>r.json()).then(setReports)
  }, [id])

  async function createReport(formData: FormData) {
    const body = Object.fromEntries(formData.entries()) as any
    theaders = { 'Content-Type':'application/json', 'x-user-id': uid || '' }
    const res = await fetch(`${API}/trucks/${id}/reports`, {
      method: 'POST', headers: theaders,
      body: JSON.stringify({ odometer: Number(body.odometer||0), summary: body.summary })
    })
    if (res.ok) setReports([await res.json(), ...reports])
  }

  if (!truck) return <main className="p-6">Loading...</main>

  return (
    <main className="p-6 space-y-6">
      <a href="/trucks" className="text-sm">← Back</a>
      <h1 className="text-2xl font-bold">Truck #{truck.number}</h1>

      <form action={createReport} className="grid md:grid-cols-3 gap-2 border rounded-2xl p-4">
        <input name="odometer" placeholder="Odometer" className="border p-2 rounded-xl"/>
        <input name="summary" placeholder="Summary (optional)" className="border p-2 rounded-xl md:col-span-2"/>
        <button className="border rounded-xl p-2">New Report</button>
      </form>

      <ul className="grid gap-2">
        {reports.map(r => (
          <li key={r.id}>
            <a href={`/reports/${r.id}`} className="block p-3 rounded-xl border hover:bg-gray-50">
              <div className="font-semibold">Report #{r.id}</div>
              <div className="text-sm text-gray-600">{new Date(r.created_at).toLocaleString()} • Status {r.status}</div>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}
