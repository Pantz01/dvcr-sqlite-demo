'use client'

import { useEffect, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'
import Link from 'next/link'

type Truck = {
  id: number
  number: string
  vin?: string | null
  active: boolean
  odometer: number
}

type PM = {
  odometer: number
  oil_next_due: number
  oil_miles_remaining: number
  chassis_next_due: number
  chassis_miles_remaining: number
}

type Service = {
  id: number
  truck_id: number
  service_type: 'oil' | 'chassis'
  odometer: number
  notes?: string | null
  created_at: string
}

export default function AdminTrucksPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <AdminTrucksInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function AdminTrucksInner() {
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [selected, setSelected] = useState<Truck | null>(null)

  // 🔹 NEW: edit/lock + local form copy
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<Truck | null>(null)

  const [pm, setPm] = useState<PM | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => { loadTrucks() }, [])

  async function loadTrucks() {
    const r = await fetch(`${API}/trucks`, { headers: authHeaders() })
    if (!r.ok) { alert(await r.text()); return }
    setTrucks(await r.json())
  }

  // 🔹 Dirty check used when switching trucks mid-edit
  const isDirty =
    !!selected && !!form && (
      selected.number !== form.number ||
      (selected.vin ?? '') !== (form.vin ?? '') ||
      selected.active !== form.active ||
      Number(selected.odometer ?? 0) !== Number(form.odometer ?? 0)
    )

  async function selectTruck(t: Truck) {
    // 🔹 Prevent state bleed: confirm if unsaved changes
    if (isEditing && isDirty) {
      const ok = confirm('You have unsaved changes. Discard and switch trucks?')
      if (!ok) return
    }

    setSelected(t)
    setIsEditing(false)       // lock fields
    setForm({ ...t })        // fresh local copy for controlled inputs

    setPm(null)
    setServices([])
    fetch(`${API}/trucks/${t.id}/pm-next`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null).then(setPm)
    fetch(`${API}/trucks/${t.id}/service`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : []).then(setServices)
  }

  // ⚠️ Kept for compatibility (not used by onBlur anymore)
  async function saveField(t: Truck, patch: Partial<Truck>) {
    const r = await fetch(`${API}/trucks/${t.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(patch),
    })
    if (!r.ok) { alert(await r.text()); return }
    const updated = await r.json()
    setTrucks(prev => prev.map(x => x.id === t.id ? updated : x))
    if (selected?.id === t.id) {
      setSelected(updated)
      setForm({ ...updated }) // keep form in sync
    }
    if (patch.odometer !== undefined) {
      const p = await fetch(`${API}/trucks/${t.id}/pm-next`, { headers: authHeaders() })
      if (p.ok) setPm(await p.json())
    }
  }

  // 🔹 NEW: Save all edits at once, then refresh PM/services
  async function saveEdits() {
    if (!form) return
    setBusy(true)
    const r = await fetch(`${API}/trucks/${form.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({
        number: form.number,
        vin: form.vin ?? null,
        active: !!form.active,
        odometer: Number(form.odometer ?? 0),
      }),
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
    const updated: Truck = await r.json()
    setTrucks(prev => prev.map(x => x.id === updated.id ? updated : x))
    setSelected(updated)
    setForm({ ...updated })
    setIsEditing(false)

    // refresh PM + services snapshot
    const p = await fetch(`${API}/trucks/${updated.id}/pm-next`, { headers: authHeaders() })
    if (p.ok) setPm(await p.json())
    const s = await fetch(`${API}/trucks/${updated.id}/service`, { headers: authHeaders() })
    if (s.ok) setServices(await s.json())
  }

  function cancelEdits() {
    if (selected) setForm({ ...selected })
    setIsEditing(false)
  }

  async function addService(truck: Truck, service_type: 'oil' | 'chassis', odometer: number, notes: string) {
    setBusy(true)
    const r = await fetch(`${API}/trucks/${truck.id}/service`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ service_type, odometer, notes }),
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
    // refresh PM + list
    selectTruck(truck)
  }

  async function deleteService(serviceId: number) {
    if (!selected) return
    if (!confirm('Delete this service record?')) return
    const r = await fetch(`${API}/service/${serviceId}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    selectTruck(selected)
  }

  async function deleteTruck(t: Truck) {
    if (!confirm(`Delete truck ${t.number}? This will remove its reports/defects/photos/services.`)) return
    const r = await fetch(`${API}/trucks/${t.id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    setSelected(null); setPm(null); setServices([]); setForm(null); setIsEditing(false)
    loadTrucks()
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Admin · Trucks</h1>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Left: truck list */}
        <div className="border rounded-2xl overflow-hidden">
          <div className="p-3 font-semibold border-b">Fleet</div>
          <div className="max-h-[60vh] overflow-auto divide-y">
            {trucks.map(t => (
              <div
                key={t.id}
                className={`p-3 hover:bg-gray-50 ${selected?.id === t.id ? 'bg-gray-50' : ''}`}
              >
                <button
                  className="w-full text-left"
                  onClick={() => selectTruck(t)}
                  aria-label={`Select truck ${t.number}`}
                >
                  <div className="font-medium flex items-center gap-2">
                    <span>{t.number}</span>
                  </div>
                  <div className="text-xs text-gray-600">
                    VIN {t.vin || '—'} · Odo {t.odometer ?? 0} · {t.active ? 'Active' : 'Inactive'}
                  </div>
                </button>

                {/* Per-row admin link */}
                <div className="mt-2">
                  <Link
                    href={`/admin/trucks/${t.id}`}
                    className="text-xs underline"
                  >
                    View Reports
                  </Link>
                </div>
              </div>
            ))}
            {trucks.length === 0 && (
              <div className="p-3 text-sm text-gray-500">No trucks.</div>
            )}
          </div>
        </div>

        {/* Right: details & actions */}
        <div className="md:col-span-2 space-y-4">
          <div className="border rounded-2xl">
            <div className="p-3 font-semibold border-b flex items-center justify-between">
              <span>Details</span>
              {selected && (
                <div className="flex gap-2">
                  {!isEditing ? (
                    <button
                      className="px-3 py-1.5 border rounded-xl"
                      onClick={() => setIsEditing(true)}
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        className="px-3 py-1.5 border rounded-xl"
                        onClick={cancelEdits}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                      <button
                        className="px-3 py-1.5 border rounded-xl bg-black text-white disabled:opacity-50"
                        onClick={saveEdits}
                        disabled={busy}
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {!selected ? (
              <div className="p-4 text-sm text-gray-500">Select a truck on the left.</div>
            ) : (
              <div className="p-4 space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Labeled label="Truck Number">
                    <input
                      value={form?.number ?? ''}
                      readOnly={!isEditing}
                      onChange={(e) => setForm(f => f ? { ...f, number: e.target.value } : f)}
                      className={`border p-2 rounded-xl w-full ${!isEditing ? 'bg-gray-100' : ''}`}
                    />
                  </Labeled>

                  <Labeled label="VIN">
                    <input
                      value={form?.vin ?? ''}
                      readOnly={!isEditing}
                      onChange={(e) => setForm(f => f ? { ...f, vin: (e.target.value || null) as any } : f)}
                      className={`border p-2 rounded-xl w-full ${!isEditing ? 'bg-gray-100' : ''}`}
                    />
                  </Labeled>

                  <Labeled label="Odometer">
                    <input
                      type="number"
                      value={form?.odometer ?? 0}
                      readOnly={!isEditing}
                      onChange={(e) => setForm(f => f ? { ...f, odometer: parseInt(e.target.value || '0', 10) } : f)}
                      className={`border p-2 rounded-xl w-full ${!isEditing ? 'bg-gray-100' : ''}`}
                    />
                  </Labeled>

                  <Labeled label="Active">
                    <select
                      value={form?.active ? '1' : '0'}
                      disabled={!isEditing}
                      onChange={(e) => setForm(f => f ? { ...f, active: e.target.value === '1' } : f)}
                      className={`border p-2 rounded-xl w-full ${!isEditing ? 'bg-gray-100' : ''}`}
                    >
                      <option value="1">Active</option>
                      <option value="0">Inactive</option>
                    </select>
                  </Labeled>
                </div>

                {/* PM snapshot */}
                <div className="border rounded-2xl p-3">
                  <div className="font-semibold mb-2">PM Status</div>
                  {pm ? (
                    <div className="grid sm:grid-cols-2 gap-2 text-sm">
                      <div>Odometer: <b>{pm.odometer}</b></div>
                      <div>Oil next due: <b>{pm.oil_next_due}</b> ({pm.oil_miles_remaining} mi left)</div>
                      <div>Chassis next due: <b>{pm.chassis_next_due}</b> ({pm.chassis_miles_remaining} mi left)</div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">—</div>
                  )}
                </div>

                {/* Manage reports link (for the selected truck) */}
                <div>
                  <Link href={`/admin/trucks/${selected.id}`} className="underline">
                    View Reports
                  </Link>
                </div>

                {/* Add service */}
                <AddServiceCard
                  busy={busy}
                  onAdd={(svc, odo, notes) => selected && addService(selected, svc, odo, notes)}
                />

                {/* Service history */}
                <div className="border rounded-2xl overflow-hidden">
                  <div className="p-3 font-semibold border-b">Service History</div>
                  <div className="max-h-[40vh] overflow-auto divide-y">
                    {services.map(s => (
                      <div key={s.id} className="p-3 flex items-center gap-3">
                        <div className="w-20 uppercase text-xs">{s.service_type}</div>
                        <div className="flex-1 text-sm">
                          Odo {s.odometer} · {new Date(s.created_at).toLocaleString()}
                          {s.notes ? <span className="text-gray-600"> · {s.notes}</span> : null}
                        </div>
                        <button className="text-xs underline text-red-600" onClick={() => deleteService(s.id)}>
                          Delete
                        </button>
                      </div>
                    ))}
                    {services.length === 0 && (
                      <div className="p-3 text-sm text-gray-500">No services yet.</div>
                    )}
                  </div>
                </div>

                {/* Danger zone */}
                <div className="border rounded-2xl p-3">
                  <div className="font-semibold mb-2">Danger Zone</div>
                  <button
                    className="border border-red-600 text-red-600 rounded-xl px-3 py-2"
                    onClick={() => selected && deleteTruck(selected)}
                  >
                    Delete Truck
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      {children}
    </label>
  )
}

function AddServiceCard({
  busy,
  onAdd,
}: {
  busy: boolean
  onAdd: (t: 'oil' | 'chassis', odo: number, notes: string) => void
}) {
  const [svc, setSvc] = useState<'oil' | 'chassis'>('oil')
  const [odo, setOdo] = useState<number>(0)
  const [notes, setNotes] = useState('')

  return (
    <div className="border rounded-2xl p-3 space-y-2">
      <div className="font-semibold">Add Service</div>
      <div className="grid sm:grid-cols-5 gap-2">
        <select
          className="border p-2 rounded-xl"
          value={svc}
          onChange={(e) => setSvc(e.target.value as 'oil' | 'chassis')}
        >
          <option value="oil">oil</option>
          <option value="chassis">chassis</option>
        </select>

        <input
          type="number"
          className="border p-2 rounded-xl"
          placeholder="Odometer"
          value={odo}
          onChange={(e) => setOdo(parseInt(e.target.value || '0', 10))}
        />

        <input
          className="border p-2 rounded-xl sm:col-span-2"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <button
          className="border rounded-xl p-2"
          disabled={busy}
          onClick={() => onAdd(svc, odo, notes)}
        >
          {busy ? 'Saving…' : 'Add service'}
        </button>
      </div>

      <p className="text-xs text-gray-600">
        Tip: To change the “next due”, add a service at the odometer that represents the last completed service.
      </p>
    </div>
  )
}
