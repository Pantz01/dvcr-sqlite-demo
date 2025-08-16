'use client'

import { useEffect, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders } from '@/lib/api'

type PMAlert = {
  truck_id: number
  truck_number: string
  odometer: number
  oil_next_due: number
  oil_miles_remaining: number
  chassis_next_due: number
  chassis_miles_remaining: number
  oil_due_soon: boolean
  chassis_due_soon: boolean
}

export default function AlertsPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager','admin']}>
        <AlertsInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function AlertsInner() {
  const [items, setItems] = useState<PMAlert[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    const r = await fetch(`${API}/alerts/pm`, { headers: authHeaders() })
    setLoading(false)
    if (!r.ok) { alert(await r.text()); return }
    setItems(await r.json())
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 60_000) // refresh every 60s
    return () => clearInterval(id)
  }, [])

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">PM Alerts</h1>
        {loading && <span className="text-sm text-gray-600">Refreshing…</span>}
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-gray-600">No trucks are nearing PM thresholds.</div>
      ) : (
        <div className="border rounded-2xl overflow-hidden">
          <div className="grid grid-cols-7 gap-px bg-gray-200 text-sm font-semibold">
            <div className="bg-white p-2">Truck</div>
            <div className="bg-white p-2">Odometer</div>
            <div className="bg-white p-2">Oil next due</div>
            <div className="bg-white p-2">Oil mi left</div>
            <div className="bg-white p-2">Chassis next due</div>
            <div className="bg-white p-2">Chassis mi left</div>
            <div className="bg-white p-2">Actions</div>
          </div>
          {items.map(a => (
            <div key={a.truck_id} className="grid grid-cols-7 gap-px bg-gray-200 text-sm">
              <div className="bg-white p-2">
                <a className="underline" href={`/trucks/${a.truck_id}`}>{a.truck_number}</a>
              </div>
              <div className="bg-white p-2">{a.odometer.toLocaleString()}</div>
              <div className="bg-white p-2">{a.oil_next_due.toLocaleString()}</div>
              <div className={`bg-white p-2 ${a.oil_due_soon ? 'text-red-600 font-semibold' : ''}`}>
                {a.oil_miles_remaining.toLocaleString()}
              </div>
              <div className="bg-white p-2">{a.chassis_next_due.toLocaleString()}</div>
              <div className={`bg-white p-2 ${a.chassis_due_soon ? 'text-amber-600 font-semibold' : ''}`}>
                {a.chassis_miles_remaining.toLocaleString()}
              </div>
              <div className="bg-white p-2">
                <a className="underline" href={`/trucks/${a.truck_id}`}>Open truck</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
