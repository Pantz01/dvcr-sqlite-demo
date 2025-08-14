const API = process.env.NEXT_PUBLIC_API!;
'use client'
import { useEffect, useState } from 'react'

export default function TrucksPage() {
  const [trucks, setTrucks] = useState<any[]>([])
  const uid = typeof window !== 'undefined' ? localStorage.getItem('x-user-id') : null

  useEffect(() => {
    fetch(`${API}/trucks`).then(r=>r.json()).then(setTrucks)
  }, [])

  async function createTruck(formData: FormData) {
    const body = Object.fromEntries(formData.entries()) as any
    const res = await fetch(`${API}/trucks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': uid || '' },
      body: JSON.stringify({ number: body.number, vin: body.vin })
    })
    if (res.ok) setTrucks([...(trucks||[]), await res.json()])
    else alert('Only managers can create trucks (MVP)')
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
        <input name="number" placeholder="Truck number" className="border p-2 rounded-xl" required/>
        <input name="vin" placeholder="VIN (optional)" className="border p-2 rounded-xl"/>
        <button className="rounded-xl border p-2">Add truck (manager)</button>
      </form>
    </main>
  )
}
