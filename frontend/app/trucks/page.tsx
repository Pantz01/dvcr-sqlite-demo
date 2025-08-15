'use client'
import { useEffect, useState } from 'react'
import { API, jsonHeaders, authHeaders } from '@/lib/api'

export default function TrucksPage() {
  const [trucks, setTrucks] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('user') || 'null') : null
  const isManager = user?.role === 'manager' || user?.role === 'admin'

  useEffect(() => {
    fetch(`${API}/trucks`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => setTrucks(Array.isArray(data) ? data : []))
      .catch(() => alert('Could not load trucks. Check API URL/CORS/login.'))
  }, [])

  async function createTruck(formData: FormData) {
    if (!isManager) { alert('Only managers can add trucks'); return }
    try {
      setBusy(true)
      const body = Object.fromEntries(Array.from(formData.entries())) as any
      const r = await fetch(`${API}/trucks`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ number: body.number, vin: body.vin, active: true })
      })
      if (!r.ok) { alert(await r.text()); return }
      const created = await r.json()
      setTrucks([...(trucks||[]), created])
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trucks</h1>
        {user && <span className="text-sm text-gray-600">Signed in as {user.name} ({user.role})</span>}
      </div>

      <ul className="grid gap-2">
        {trucks.map(t => (
          <li key={t.id}>
            <a href={`/trucks/${t.id}`} className="block p-3 rounded-xl border hover:bg-gray-50">
              <div className="font-semibold">#{t.number}</div>
              <div className="text-sm text-gray-600">VIN: {t.vin} · Odo: {t.odometer?.toLocaleString?.() ?? t.odometer}</div>
            </a>
          </li>
        ))}
      </ul>

      {isManager && (
        <form action={createTruck} className="border rounded-2xl p-4 grid sm:grid-cols-3 gap-2">
          <input name="number" placeholder="Truck number" className="border p-2 rounded-xl" required />
          <input name="vin" placeholder="VIN (optional)" className="border p-2 rounded-xl" />
          <button disabled={busy} className="rounded-xl border p-2">{busy ? 'Adding…' : 'Add truck'}</button>
        </form>
      )}
    </main>
  )
}
