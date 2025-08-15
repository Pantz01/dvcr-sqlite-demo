'use client'
const API = process.env.NEXT_PUBLIC_API as string;

import { useEffect, useState } from 'react'

export default function TrucksPage() {
  const [trucks, setTrucks] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const uid = typeof window !== 'undefined' ? localStorage.getItem('x-user-id') : null

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch(`${API}/trucks`)
        if (!r.ok) throw new Error(`List trucks failed: ${r.status}`)
        const data = await r.json()
        setTrucks(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error(err)
        alert('Could not load trucks. Check API URL / CORS.')
      }
    }
    load()
  }, [])

  async function createTruck(formData: FormData) {
    if (!uid) { alert('Please go to /login and pick a user (Manager to add trucks).'); return }
    if (!API) { alert('Missing NEXT_PUBLIC_API on frontend'); return }

    try {
      setBusy(true)
      const body = Object.fromEntries(Array.from(formData.entries())) as any
      const headers = { 'Content-Type': 'application/json', 'x-user-id': uid }

      const res = await fetch(`${API}/trucks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ number: body.number, vin: body.vin })
      })

      if (!res.ok) {
        // Try to show backend error message
        let msg = `Add truck failed (${res.status})`
        try {
          const j = await res.json()
          if (j?.detail) msg = Array.isArray(j.detail) ? j.detail.map((d:any)=>d.msg||d).join(', ') : j.detail
        } catch { /* text fallback */ 
          try { msg = await res.text() } catch {}
        }
        alert(msg)
        return
      }

      const created = await res.json()
      setTrucks([...(trucks || []), created])
    } catch (err) {
      console.error(err)
      alert('Unexpected error adding truck. See console for details.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Trucks</h1>

      <ul className="grid gap-2">
        {trucks.map(t => (
          <li key={t.id}>
            <a href={`/trucks/${t.id}`} className="block p-3 rounded-xl border hover:bg-gray-50">
              <div className="font-semibold">#{t.number}</div>
              <div className="text-sm text-gray-600">VIN: {t.vin}</div>
            </a>
          </li>
        ))}
      </ul>

      <form action={createTruck} className="border rounded-2xl p-4 grid sm:grid-cols-3 gap-2">
        <input name="number" placeholder="Truck number" className="border p-2 rounded-xl" required />
        <input name="vin" placeholder="VIN (optional)" className="border p-2 rounded-xl" />
        <button disabled={busy} className="rounded-xl border p-2">
          {busy ? 'Adding…' : 'Add truck (manager)'}
        </button>
      </form>
    </main>
  )
}
