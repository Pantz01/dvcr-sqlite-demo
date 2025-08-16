'use client'
import { useEffect, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

type Truck = { id:number; number:string; vin?:string|null; active:boolean; odometer:number }
type PM = { odometer:number; oil_next_due:number; oil_miles_remaining:number; chassis_next_due:number; chassis_miles_remaining:number }
type Service = { id:number; truck_id:number; service_type:'oil'|'chassis'; odometer:number; notes?:string|null; created_at:string }

export default function AdminTrucksPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager','admin']}>
        <TrucksInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function TrucksInner() {
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [selected, setSelected] = useState<Truck|null>(null)
  const [pm, setPm] = useState<PM|null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [busy, setBusy] = useState(false)

  async function loadTrucks() {
    const r = await fetch(`${API}/trucks`, { headers: authHeaders() })
    if (!r.ok) { alert(await r.text()); return }
    setTrucks(await r.json())
  }
  useEffect(() => { loadTrucks() }, [])

  async function selectTruck(t: Truck) {
    setSelected(t); setPm(null); setServices([])
    fetch(`${API}/trucks/${t.id}/pm-next`, { headers: authHeaders() }).then(r=>r.ok?r.json():null).then(setPm)
    fetch(`${API}/trucks/${t.id}/service`, { headers: authHeaders() }).then(r=>r.ok?r.json():[]).then(setServices)
  }

  async function saveField(t: Truck, patch: Partial<Truck>) {
    const r = await fetch(`${API}/trucks/${t.id}`, {
      method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch)
    })
    if (!r.ok) { alert(await r.text()); return }
    const updated = await r.json()
    setTrucks(prev => prev.map(x => x.id === t.id ? updated : x))
    if (selected?.id === t.id) setSelected(updated)
    // If odometer changed, refresh PM
    if (patch.odometer !== undefined) {
      const p = await fetch(`${API}/trucks/${t.id}/pm-next`, { headers: authHeaders() })
      if (p.ok) setPm(await p.json())
    }
  }

  async function addService(t: Truck, service_type:'oil'|'chassis', odometer:number, notes:string) {
    setBusy(true)
    const r = await fetch(`${API}/trucks/${t.id}/service`, {
      method:'POST', headers: jsonHeaders(),
      body: JSON.stringify({ service_type, odometer, notes })
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
    // refresh PM + list
    selectTruck(t)
  }

  async function deleteService(id:number) {
    if (!selected) return
    if (!confirm('Delete this service record?')) return
    const r = await fetch(`${API}/service/${id}`, { method:'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    selectTruck(selected)
  }

  async function deleteTruck(t: Truck) {
    if (!confirm(`Delete truck ${t.number}? This removes its reports/defects/photos.`)) return
    const r = await fetch(`${API}/trucks/${t.id}`, { method:'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    setSelected(null); setPm(null); setServices([])
    loadTrucks()
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Admin · Trucks</h1>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Left: list */}
        <div className="border rounded-2xl">
          <div className="p-3 font-semibold border-b">Fleet</div>
          <div className="max-h-[60vh] overflow-auto divide-y">
            {trucks.map(t => (
              <button key={t.id}
                className={`w-full text-left p-3 hover:bg-gray-50 ${selected?.id===t.id?'bg-gray-50':''}`}
                onClick={()=>selectTruck(t)}>
                <div className="font-medium">{t.number}</div>
                <div className="text-xs text-gray-600">VIN {t.vin || '—'} · Odo {t.odometer ?? 0} · {t.active?'Active':'Inactive'}</div>
              </button>
            ))}
            {trucks.length===0 && <div className="p-3 text-sm text-gray-500">No trucks.</div>}
          </div>
        </div>

        {/* Middle: edit form */}
        <div className="border rounded-2xl md:col-span-2">
          <div className="p-3 font-semibold border-b">Details</div>
          {!selected ? (
            <div className="p-4 text-sm text-gray-500">Select a truck on the left.</div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label="Truck Number">
                  <input defaultValue={selected.number} className="border p-2 rounded-xl w-full"
                         onBlur={(e)=>saveField(selected,{number:e.target.value})}/>
                </Labeled>
                <Labeled label="VIN">
                  <input defaultValue={selected.vin ?? ''} className="border p-2 rounded-xl w-full"
                         onBlur={(e)=>saveField(selected,{vin:e.target.value || null as any})}/>
                </Labeled>
                <Labeled label="Odometer">
                  <input type="number" defaultValue={selected.odometer ?? 0} className="border p-2 rounded-xl w-full"
                         onBlur={(e)=>saveField(selected,{odometer: parseInt(e.target.value||'0',10)})}/>
                </Labeled>
                <Labeled label="Active">
                  <select defaultValue={selected.active ? '1' : '0'} className="border p-2 rounded-xl w-full"
                          onChange={(e)=>saveField(selected,{active: e.target.value==='1'})}>
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
                ) : <div className="text-sm text-gray-500">—</div>}
              </div>

              {/* Quick add service */}
              <AddServiceCard
                busy={busy}
                onAdd={(svc, odo, notes)=>addService(selected, svc, odo, notes)}
              />

              {/* Service history */}
              <div className="border rounded-2xl">
                <div className="p-3 font-semibold border-b">Service History</div>
                <div className="max-h-[40vh] overflow-auto divide-y">
                  {services.map(s => (
                    <div key={s.id} className="p-3 flex items-center gap-3">
                      <div className="w-20 uppercase text-xs">{s.service_type}</div>
                      <div className="flex-1 text-sm">Odo {s.odometer} · {new Date(s.created_at).toLocaleString()}</div>
                      <div className="text-xs text-gray-600">{s.notes}</div>
                      <button className="text-xs underline text-red-600" onClick={()=>deleteService(s.id)}>Delete</button>
                    </div>
                  ))}
                  {services.length===0 && <div className="p-3 text-sm text-gray-500">No services yet.</div>}
                </div>
              </div>

              {/* Danger zone */}
              <div className="border rounded-2xl p-3">
                <div className="font-semibold mb-2">Danger Zone</div>
                <button className="border border-red-600 text-red-600 rounded-xl px-3 py-2"
                        onClick={()=>deleteTruck(selected!)}>Delete Truck</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function Labeled({ label, children }: { label:string; children:React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      {children}
    </label>
  )
}

function AddServiceCard({ busy, onAdd }:{ busy:boolean; onAdd:(t:'oil'|'chassis', odo:number, notes:string)=>void }) {
  const [svc, setSvc] = useState<'oil'|'chassis'>('oil')
  const [odo, setOdo] = useState<number>(0)
  const [notes, setNotes] = useState('')

  return (
    <div className="border rounded-2xl p-3 space-y-2">
      <div className="font-semibold">Add Service</div>
      <div className="grid sm:grid-cols-5 gap-2">
        <select className="border p-2 rounded-xl" value={svc} onChange={e=>setSvc(e.target.value as any)}>
          <option value="oil">oil</option>
          <option value="chassis">chassis</option>
        </select>
        <input type="number" className="border p-2 rounded-xl" placeholder="Odometer" value={odo}
               onChange={e=>setOdo(parseInt(e.target.value||'0',10))}/>
        <input className="border p-2 rounded-xl sm:col-span-2" placeholder="Notes (optional)" value={notes} onChange={e=>setNotes(e.target.value)}/>
        <button className="border rounded-xl p-2" disabled={busy}
                onClick={()=>onAdd(svc, odo, notes)}>{busy?'Saving…':'Add service'}</button>
      </div>
      <p className="text-xs text-gray-600">
        Tip: to change the “next due”, add a service with the odometer that represents the last completed service.
      </p>
    </div>
  )
}
