'use client'

import { useEffect, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

type AlertRow = {
  truck_id: number
  truck_number: string
  odometer: number
  oil_next_due: number
  oil_miles_remaining: number
  chassis_next_due: number
  chassis_miles_remaining: number
  oil_due_soon: boolean
  chassis_due_soon: boolean
  oil_appt?: { id: number; shop: string; scheduled_date: string; status: string } | null
  chassis_appt?: { id: number; shop: string; scheduled_date: string; status: string } | null
}

export default function PMPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager','admin']}>
        <PMInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function PMInner() {
  const [rows, setRows] = useState<AlertRow[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)

  async function load() {
    const r = await fetch(`${API}/alerts/pm`, { headers: authHeaders() })
    if (!r.ok) { alert(await r.text()); return }
    setRows(await r.json())
  }
  useEffect(() => { load() }, [])

  async function schedule(truck_id: number, service_type: 'oil' | 'chassis', shop: string, date: string) {
    setBusyId(truck_id)
    const r = await fetch(`${API}/pm/appointments`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        truck_id,
        service_type,
        shop,
        scheduled_date: new Date(date).toISOString(),
      }),
    })
    setBusyId(null)
    if (!r.ok) { alert(await r.text()); return }
    load()
  }

  async function updateAppt(id: number, patch: Partial<{ shop: string; scheduled_date: string; status: string }>) {
    const r = await fetch(`${API}/pm/appointments/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(patch),
    })
    if (!r.ok) { alert(await r.text()); return }
    load()
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">PM Scheduler</h1>

      <div className="rounded-2xl border overflow-auto">
        <table className="min-w-[900px] w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Truck</th>
              <th className="text-left p-2">Odometer</th>
              <th className="text-left p-2">Oil (mi left)</th>
              <th className="text-left p-2">Chassis (mi left)</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PMRow
                key={r.truck_id}
                row={r}
                busy={busyId === r.truck_id}
                onSchedule={schedule}
                onUpdateAppt={updateAppt}
              />
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-3 text-sm text-gray-500">No trucks need PM soon.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function PMRow({
  row,
  busy,
  onSchedule,
  onUpdateAppt,
}: {
  row: AlertRow
  busy: boolean
  onSchedule: (truck_id: number, service_type: 'oil' | 'chassis', shop: string, date: string) => void
  onUpdateAppt: (id: number, patch: Partial<{ shop: string; scheduled_date: string; status: string }>) => void
}) {
  const [shopOil, setShopOil] = useState('')
  const [dateOil, setDateOil] = useState('')
  const [shopCh, setShopCh] = useState('')
  const [dateCh, setDateCh] = useState('')

  return (
    <tr className="border-t align-top">
      <td className="p-2">
        <div className="font-medium">{row.truck_number}</div>
        <div className="text-xs text-gray-600">ID {row.truck_id}</div>
      </td>
      <td className="p-2">{row.odometer}</td>
      <td className="p-2">
        <div className={row.oil_due_soon ? 'text-red-600 font-semibold' : ''}>
          {row.oil_miles_remaining}
        </div>
        {row.oil_appt ? (
          <div className="text-xs text-gray-700 mt-1 space-y-1">
            <div>Appt: {row.oil_appt.shop} · {new Date(row.oil_appt.scheduled_date).toLocaleDateString()}</div>
            <div>Status: {row.oil_appt.status}</div>
            <div className="space-x-2">
              <button className="underline text-xs" onClick={() => onUpdateAppt(row.oil_appt!.id, { status: 'completed' })}>Mark completed</button>
              <button className="underline text-xs" onClick={() => onUpdateAppt(row.oil_appt!.id, { status: 'cancelled' })}>Cancel</button>
            </div>
          </div>
        ) : row.oil_due_soon ? (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <input className="border p-1 rounded text-sm" placeholder="Shop" value={shopOil} onChange={e=>setShopOil(e.target.value)} />
            <input className="border p-1 rounded text-sm" type="date" value={dateOil} onChange={e=>setDateOil(e.target.value)} />
            <button
              className="border rounded px-2 text-sm"
              disabled={busy || !shopOil || !dateOil}
              onClick={() => onSchedule(row.truck_id, 'oil', shopOil, dateOil)}
            >
              {busy ? 'Saving…' : 'Schedule'}
            </button>
          </div>
        ) : null}
      </td>
      <td className="p-2">
        <div className={row.chassis_due_soon ? 'text-orange-600 font-semibold' : ''}>
          {row.chassis_miles_remaining}
        </div>
        {row.chassis_appt ? (
          <div className="text-xs text-gray-700 mt-1 space-y-1">
            <div>Appt: {row.chassis_appt.shop} · {new Date(row.chassis_appt.scheduled_date).toLocaleDateString()}</div>
            <div>Status: {row.chassis_appt.status}</div>
            <div className="space-x-2">
              <button className="underline text-xs" onClick={() => onUpdateAppt(row.chassis_appt!.id, { status: 'completed' })}>Mark completed</button>
              <button className="underline text-xs" onClick={() => onUpdateAppt(row.chassis_appt!.id, { status: 'cancelled' })}>Cancel</button>
            </div>
          </div>
        ) : row.chassis_due_soon ? (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <input className="border p-1 rounded text-sm" placeholder="Shop" value={shopCh} onChange={e=>setShopCh(e.target.value)} />
            <input className="border p-1 rounded text-sm" type="date" value={dateCh} onChange={e=>setDateCh(e.target.value)} />
            <button
              className="border rounded px-2 text-sm"
              disabled={busy || !shopCh || !dateCh}
              onClick={() => onSchedule(row.truck_id, 'chassis', shopCh, dateCh)}
            >
              {busy ? 'Saving…' : 'Schedule'}
            </button>
          </div>
        ) : null}
      </td>
      <td className="p-2">
        <div className="text-xs text-gray-600">
          Oil due @ {row.oil_next_due} · Chassis due @ {row.chassis_next_due}
        </div>
      </td>
    </tr>
  )
}
