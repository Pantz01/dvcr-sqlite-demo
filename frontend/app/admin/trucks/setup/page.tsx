// app/admin/trucks/setup/page.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

type TruckRec = {
  id: number
  number: string
  vin?: string | null
  active: boolean
  odometer: number
  // If your API already returns fleet on the truck, this will populate automatically
  fleet?: string | null
}

type NewTruckForm = {
  number: string
  vin: string
  odometer: string
  active: boolean
  fleet: string
}

const LS_FLEET_META = 'fleetMeta:v1'

export default function TruckSetupPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <TruckSetupInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function TruckSetupInner() {
  const [trucks, setTrucks] = useState<TruckRec[]>([])
  // local fleet meta (fallback if server can't store fleet)
  const [metaByTruck, setMetaByTruck] = useState<Record<string, { fleet?: string }>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // UI
  const [fleetFilter, setFleetFilter] = useState<string>('__all__')
  const [query, setQuery] = useState('')

  // inline fleet editing
  const [editingFleet, setEditingFleet] = useState<Record<number, boolean>>({})
  const [draftFleet, setDraftFleet] = useState<Record<number, string>>({})

  // add-truck form
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<NewTruckForm>({
    number: '',
    vin: '',
    odometer: '',
    active: true,
    fleet: '',
  })

  useEffect(() => {
    loadTrucks()
    // load local fleet meta
    try {
      const raw = localStorage.getItem(LS_FLEET_META)
      if (raw) setMetaByTruck(JSON.parse(raw))
    } catch {}
  }, [])

  async function loadTrucks() {
    setError(null)
    setLoading(true)
    try {
      const r = await fetch(`${API}/trucks`, { headers: authHeaders() })
      if (!r.ok) throw new Error(await r.text())
      const list: TruckRec[] = await r.json()
      setTrucks(list)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load trucks')
    } finally {
      setLoading(false)
    }
  }

  // ---------- Helpers for fleet storage ----------
  function getShownFleet(t: TruckRec): string {
    // Prefer server fleet if present; else from local meta store
    const fromServer = (t as any)?.fleet
    if (fromServer && String(fromServer).trim()) return String(fromServer).trim()
    const local = metaByTruck[t.number]?.fleet
    return local ? local : ''
  }

  function saveLocalFleet(truckNumber: string, fleet: string) {
    const next = { ...metaByTruck, [truckNumber]: { ...(metaByTruck[truckNumber] ?? {}), fleet: fleet || undefined } }
    setMetaByTruck(next)
    try {
      localStorage.setItem(LS_FLEET_META, JSON.stringify(next))
    } catch {}
  }

  async function trySetFleetOnServer(truck: TruckRec, fleet: string) {
    // 1) Try PATCH /trucks/:id with { fleet }
    try {
      const r1 = await fetch(`${API}/trucks/${truck.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ fleet }),
      })
      if (r1.ok) return true
    } catch {}
    // 2) Try POST /trucks/bulk-meta (as we used on Fleet Info page)
    try {
      const r2 = await fetch(`${API}/trucks/bulk-meta`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' } as any,
        body: JSON.stringify([{ truck_id: truck.id, fleet }]),
      })
      if (r2.ok) return true
    } catch {}
    // 3) Fall back to local
    saveLocalFleet(truck.number, fleet)
    return false
  }

  async function setFleetForTruck(truck: TruckRec, fleet: string) {
    const ok = await trySetFleetOnServer(truck, fleet)
    if (!ok) {
      // local fallback is already saved
    }
    await loadTrucks()
  }

  // ---------- Add truck ----------
  async function submitNewTruck(e: React.FormEvent) {
    e.preventDefault()
    if (!form.number.trim()) {
      alert('Truck number is required')
      return
    }
    const od = parseInt(form.odometer.trim() || '0', 10) || 0
    setBusy(true)
    try {
      const r = await fetch(`${API}/trucks`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          number: form.number.trim(),
          vin: form.vin.trim() || null,
          odometer: od,
          active: !!form.active,
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      const created: TruckRec = await r.json()

      // attach fleet if provided
      const fleet = form.fleet.trim()
      if (fleet) {
        await setFleetForTruck(created, fleet)
      } else {
        await loadTrucks()
      }

      // reset form
      setForm({ number: '', vin: '', odometer: '', active: true, fleet: '' })
    } catch (e: any) {
      alert(e?.message ?? 'Failed to create truck')
    } finally {
      setBusy(false)
    }
  }

  // ---------- Delete truck ----------
  async function deleteTruck(t: TruckRec) {
    if (!confirm(`Delete truck ${t.number}? This will remove its reports/defects/photos/services.`)) return
    try {
      const r = await fetch(`${API}/trucks/${t.id}`, { method: 'DELETE', headers: authHeaders() })
      if (!r.ok && r.status !== 204) throw new Error(await r.text())
      // clean local fleet mapping for this truck number
      if (metaByTruck[t.number]) {
        const copy = { ...metaByTruck }
        delete copy[t.number]
        setMetaByTruck(copy)
        try { localStorage.setItem(LS_FLEET_META, JSON.stringify(copy)) } catch {}
      }
      await loadTrucks()
    } catch (e: any) {
      alert(e?.message ?? 'Failed to delete truck')
    }
  }

  // ---------- Inline edit fleet ----------
  function startEditFleet(t: TruckRec) {
    setEditingFleet(prev => ({ ...prev, [t.id]: true }))
    setDraftFleet(prev => ({ ...prev, [t.id]: getShownFleet(t) }))
  }
  function cancelEditFleet(t: TruckRec) {
    setEditingFleet(prev => ({ ...prev, [t.id]: false }))
  }
  async function saveEditFleet(t: TruckRec) {
    const val = (draftFleet[t.id] || '').trim()
    await setFleetForTruck(t, val)
    setEditingFleet(prev => ({ ...prev, [t.id]: false }))
  }

  // ---------- Derived data ----------
  const fleets = useMemo(() => {
    const set = new Set<string>()
    for (const t of trucks) {
      const f = getShownFleet(t)
      if (f) set.add(f)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [trucks, metaByTruck])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return trucks
      .slice()
      .sort((a, b) => {
        // Sort by fleet then truck number
        const fa = getShownFleet(a) || ''
        const fb = getShownFleet(b) || ''
        if (fa !== fb) return fa.localeCompare(fb)
        return a.number.localeCompare(b.number)
      })
      .filter(t => {
        if (fleetFilter !== '__all__' && (getShownFleet(t) || '') !== fleetFilter) return false
        if (!q) return true
        const hay = [
          t.number,
          t.vin || '',
          String(t.odometer ?? ''),
          t.active ? 'active' : 'inactive',
          getShownFleet(t),
        ].join(' ').toLowerCase()
        return hay.includes(q)
      })
  }, [trucks, metaByTruck, fleetFilter, query])

  return (
    <main className="p-6 space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Truck Setup</h1>
      </div>

      {/* Add Truck (compact) */}
      <section className="border rounded-xl p-3">
        <form onSubmit={submitNewTruck} className="grid md:grid-cols-6 gap-2 items-end">
          <Field label="Truck #">
            <input
              className="border rounded-md px-2 py-1 text-sm w-full"
              value={form.number}
              onChange={(e) => setForm(f => ({ ...f, number: e.target.value }))}
              placeholder="e.g. 78974"
              required
            />
          </Field>
          <Field label="VIN">
            <input
              className="border rounded-md px-2 py-1 text-sm w-full"
              value={form.vin}
              onChange={(e) => setForm(f => ({ ...f, vin: e.target.value }))}
              placeholder="optional"
            />
          </Field>
          <Field label="Odometer">
            <input
              type="number"
              className="border rounded-md px-2 py-1 text-sm w-full"
              value={form.odometer}
              onChange={(e) => setForm(f => ({ ...f, odometer: e.target.value }))}
              placeholder="0"
              min={0}
            />
          </Field>
          <Field label="Active">
            <select
              className="border rounded-md px-2 py-1 text-sm w-full"
              value={form.active ? '1' : '0'}
              onChange={(e) => setForm(f => ({ ...f, active: e.target.value === '1' }))}
            >
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </Field>
          <Field label="Fleet Name">
            <input
              className="border rounded-md px-2 py-1 text-sm w-full"
              value={form.fleet}
              onChange={(e) => setForm(f => ({ ...f, fleet: e.target.value }))}
              placeholder="e.g. 78 Cedar Falls"
            />
          </Field>
          <div className="pt-5 md:pt-0">
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-60"
            >
              {busy ? 'Adding…' : 'Add Truck'}
            </button>
          </div>
        </form>
      </section>

      {/* Filters */}
      <div className="flex items-end gap-3">
        <label className="grid gap-1 text-xs">
          <span className="text-gray-600">Fleet</span>
          <select
            className="border rounded-md px-2 py-1 text-sm w-44"
            value={fleetFilter}
            onChange={(e) => setFleetFilter(e.target.value)}
          >
            <option value="__all__">All Fleets</option>
            {fleets.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-gray-600">Search</span>
          <input
            className="border rounded-md px-2 py-1 text-sm w-64"
            placeholder="Truck #, VIN, active/inactive, fleet…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="text-xs text-gray-600 ml-auto">
          {loading ? 'Loading…' : `${filtered.length} / ${trucks.length} trucks`}
          {error ? <span className="text-red-600"> • {error}</span> : null}
        </div>
      </div>

      {/* Table */}
      <section className="border rounded-xl overflow-hidden">
        <div className="px-3 py-2 font-semibold border-b text-sm">Trucks</div>
        <div className="overflow-auto">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col style={{ width: '110px' }} />
              <col style={{ width: '220px' }} />
              <col style={{ width: '110px' }} />
              <col style={{ width: '100px' }} />
              <col style={{ width: '220px' }} />
              <col style={{ width: '140px' }} />
            </colgroup>
            <thead className="bg-gray-50 text-xs">
              <tr>
                <th className="text-left px-2 py-1">Truck #</th>
                <th className="text-left px-2 py-1">VIN</th>
                <th className="text-left px-2 py-1">Odometer</th>
                <th className="text-left px-2 py-1">Status</th>
                <th className="text-left px-2 py-1">Fleet</th>
                <th className="text-left px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody className="leading-tight">
              {filtered.map(t => {
                const isEditing = !!editingFleet[t.id]
                const shown = getShownFleet(t)
                return (
                  <tr key={t.id} className="border-t">
                    <td className="px-2 py-1 font-medium whitespace-nowrap">{t.number}</td>
                    <td className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis" title={t.vin || ''}>
                      {t.vin?.trim() || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{t.odometer ?? 0}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{t.active ? 'Active' : 'Inactive'}</td>
                    <td className="px-2 py-1">
                      {!isEditing ? (
                        <span>{shown || <span className="text-gray-400">—</span>}</span>
                      ) : (
                        <input
                          className="border rounded-md px-2 py-1 text-sm w-full"
                          value={draftFleet[t.id] ?? ''}
                          onChange={(e) =>
                            setDraftFleet(prev => ({ ...prev, [t.id]: e.target.value }))
                          }
                          placeholder="e.g. 78 Cedar Falls"
                          autoFocus
                        />
                      )}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {!isEditing ? (
                        <div className="flex gap-2">
                          <button
                            className="px-2 py-1 text-xs border rounded-md hover:bg-gray-50"
                            onClick={() => startEditFleet(t)}
                          >
                            Edit Fleet
                          </button>
                          <button
                            className="px-2 py-1 text-xs border rounded-md hover:bg-red-50 text-red-700 border-red-300"
                            onClick={() => deleteTruck(t)}
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            className="px-2 py-1 text-xs border rounded-md"
                            onClick={() => cancelEditFleet(t)}
                          >
                            Cancel
                          </button>
                          <button
                            className="px-2 py-1 text-xs border rounded-md bg-black text-white disabled:opacity-60"
                            onClick={() => saveEditFleet(t)}
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-2 text-xs text-gray-500">No trucks to show.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-gray-600">{label}</span>
      {children}
    </label>
  )
}
