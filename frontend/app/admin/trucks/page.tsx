// app/admin/trucks/page.tsx
'use client'

import { useEffect, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx' // keep

// ---- date helper (M-D-YYYY, no leading zeros) ----
function formatDateMDY(input?: string | number | Date | null) {
  if (!input) return ''
  const d = new Date(input)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`
}

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

// ✨ Expanded service types
type ServiceType = 'oil' | 'chassis' | 'general' | 'major' | 'driver'

type Service = {
  id: number
  truck_id: number
  service_type: ServiceType
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
  const router = useRouter()

  const [trucks, setTrucks] = useState<Truck[]>([])
  const [selected, setSelected] = useState<Truck | null>(null)

  // edit/lock + local form copy
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

  // Dirty check when switching trucks mid-edit
  const isDirty =
    !!selected && !!form && (
      selected.number !== form.number ||
      (selected.vin ?? '') !== (form.vin ?? '') ||
      selected.active !== form.active ||
      Number(selected.odometer ?? 0) !== Number(form.odometer ?? 0)
    )

  async function selectTruck(t: Truck) {
    if (isEditing && isDirty) {
      const ok = confirm('You have unsaved changes. Discard and switch trucks?')
      if (!ok) return
    }

    setSelected(t)
    setIsEditing(false)
    setForm({ ...t })

    setPm(null)
    setServices([])
    fetch(`${API}/trucks/${t.id}/pm-next`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null).then(setPm)
    fetch(`${API}/trucks/${t.id}/service`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : []).then(setServices)
  }

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
      setForm({ ...updated })
    }
    if (patch.odometer !== undefined) {
      const p = await fetch(`${API}/trucks/${t.id}/pm-next`, { headers: authHeaders() })
      if (p.ok) setPm(await p.json())
    }
  }

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

    const p = await fetch(`${API}/trucks/${updated.id}/pm-next`, { headers: authHeaders() })
    if (p.ok) setPm(await p.json())
    const s = await fetch(`${API}/trucks/${updated.id}/service`, { headers: authHeaders() })
    if (s.ok) setServices(await s.json())
  }

  function cancelEdits() {
    if (selected) setForm({ ...selected })
    setIsEditing(false)
  }

  // ✨ accept expanded service types
  async function addService(truck: Truck, service_type: ServiceType, odometer: number, notes: string) {
    setBusy(true)
    const r = await fetch(`${API}/trucks/${truck.id}/service`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ service_type, odometer, notes }),
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
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

  // ⬇️ Excel export (alerts) — kept, button label compact
  function statusFromRemaining(remaining: number) {
    if (remaining <= 0) return 'OVERDUE'
    if (remaining <= 1000) return 'DUE SOON'
    return 'OK'
  }

  async function exportAlertsExcel() {
    const rows: any[] = []
    for (const t of trucks) {
      try {
        const r = await fetch(`${API}/trucks/${t.id}/pm-next`, { headers: authHeaders() })
        if (!r.ok) continue
        const pmData: PM = await r.json()
        rows.push({
          'Truck Number': t.number,
          'VIN': t.vin ?? '',
          'Active': t.active ? 'Yes' : 'No',
          'Odometer': pmData?.odometer ?? t.odometer ?? 0,
          'Oil Next Due (mi)': pmData?.oil_next_due ?? '',
          'Oil Miles Remaining': pmData?.oil_miles_remaining ?? '',
          'Oil Status': statusFromRemaining(pmData?.oil_miles_remaining ?? 0),
          'Chassis Next Due (mi)': pmData?.chassis_next_due ?? '',
          'Chassis Miles Remaining': pmData?.chassis_miles_remaining ?? '',
          'Chassis Status': statusFromRemaining(pmData?.chassis_miles_remaining ?? 0),
        })
      } catch {
        // ignore failures for individual trucks
      }
    }

    const ws = XLSX.utils.json_to_sheet(rows)
    ;(ws as any)['!cols'] = [
      { wch: 14 }, // Truck Number
      { wch: 20 }, // VIN
      { wch: 8 },  // Active
      { wch: 12 }, // Odometer
      { wch: 18 }, // Oil Next Due
      { wch: 20 }, // Oil Miles Remaining
      { wch: 12 }, // Oil Status
      { wch: 21 }, // Chassis Next Due
      { wch: 24 }, // Chassis Miles Remaining
      { wch: 14 }, // Chassis Status
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'PM Alerts')
    XLSX.writeFile(wb, 'truck_pm_alerts.xlsx')
  }
  // ⬆️ END alerts export

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
              </div>
            ))}
            {trucks.length === 0 && (
              <div className="p-3 text-sm text-gray-500">No trucks.</div>
            )}
          </div>
        </div>

        {/* Right: details & actions */}
        <div className="md:col-span-2 space-y-4">
          <div className="border rounded-2xl flex flex-col max-h-[75vh]">
            {/* Sticky header with export actions only */}
            <div className="p-3 font-semibold border-b flex items-center justify-between sticky top-0 bg-white z-10">
              <span>Details</span>
              <div className="flex gap-2">
                <button
                  className="px-2 py-1 text-xs border rounded-lg"
                  onClick={exportAlertsExcel}
                  title="Export PM alerts for all trucks"
                >
                  Export Alerts
                </button>
                <ExportAllIssuesButton />
              </div>
            </div>

            {/* Scrollable body */}
            <div className="p-4 space-y-4 overflow-auto">
              {!selected ? (
                <div className="text-sm text-gray-500">Select a truck on the left.</div>
              ) : (
                <>
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

                  {/* Button row moved LEFT, above PM Status */}
                  <div className="flex flex-wrap items-center gap-2">
                    {selected && (
                      <button
                        className="px-2 py-1 text-xs border rounded-lg"
                        onClick={() => router.push(`/admin/trucks/${selected.id}`)}
                        title="View issues for this truck"
                      >
                        View Issues
                      </button>
                    )}

                    {!isEditing ? (
                      <button
                        className="px-2 py-1 text-xs border rounded-lg"
                        onClick={() => setIsEditing(true)}
                      >
                        Edit
                      </button>
                    ) : (
                      <>
                        <button
                          className="px-2 py-1 text-xs border rounded-lg"
                          onClick={cancelEdits}
                          disabled={busy}
                        >
                          Cancel
                        </button>
                        <button
                          className="px-2 py-1 text-xs border rounded-lg bg-black text-white disabled:opacity-50"
                          onClick={saveEdits}
                          disabled={busy}
                        >
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                      </>
                    )}
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

                  {/* ✨ Add service — slimmed + expanded types */}
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
                          <div className="w-32 uppercase text-xs">{s.service_type}</div>
                          <div className="flex-1 text-sm">
                            Odo {s.odometer} · {formatDateMDY(s.created_at)}
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
                </>
              )}
            </div>
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
  onAdd: (t: ServiceType, odo: number, notes: string) => void
}) {
  const [svc, setSvc] = useState<ServiceType>('oil')
  const [odo, setOdo] = useState<number>(0)
  const [notes, setNotes] = useState('')

  return (
    <div className="border rounded-2xl p-2 space-y-2">
      <div className="text-sm font-semibold">Add Service</div>
      <div className="grid sm:grid-cols-5 gap-1.5">
        <select
          className="border p-1.5 rounded-lg text-sm"
          value={svc}
          onChange={(e) => setSvc(e.target.value as ServiceType)}
        >
          <option value="oil">Oil</option>
          <option value="chassis">Chassis</option>
          <option value="general">General Maintenance</option>
          <option value="major">Major Repairs</option>
          <option value="driver">Driver Damage</option>
        </select>

        <input
          type="number"
          className="border p-1.5 rounded-lg text-sm"
          placeholder="Odometer"
          value={odo}
          onChange={(e) => setOdo(parseInt(e.target.value || '0', 10))}
        />

        <input
          className="border p-1.5 rounded-lg text-sm sm:col-span-2"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <button
          className="border rounded-lg px-2 py-1 text-xs"
          disabled={busy}
          onClick={() => onAdd(svc, odo, notes)}
        >
          {busy ? 'Saving…' : 'Add service'}
        </button>
      </div>

      <p className="text-[11px] leading-tight text-gray-600">
        Tip: To change the “next due”, add a service at the odometer that represents the last completed service.
      </p>
    </div>
  )
}

/* =======================
   Export All Issues (CSV)
   ======================= */

function ExportAllIssuesButton() {
  const [busy, setBusy] = useState(false)

  async function fetchWithHeaders(url: string) {
    const r = await fetch(url, { headers: authHeaders() })
    if (!r.ok) throw new Error(await r.text().catch(() => 'Request failed'))
    const data = await r.json()
    const total = Number(r.headers.get('X-Total-Count') || '0')
    return { data, total }
  }

  // Page through a truck’s reports using X-Total-Count/skip/limit
  async function fetchAllReportsForTruck(truckId: number) {
    const all: any[] = []
    const limit = 500
    let skip = 0
    let total = Infinity

    while (skip < total) {
      const { data, total: t } = await fetchWithHeaders(
        `${API}/trucks/${truckId}/reports?skip=${skip}&limit=${limit}`
      )
      total = isFinite(t) && t > 0 ? t : data.length
      all.push(...data)
      skip += limit
      // Safety stop if server doesn’t send X-Total-Count
      if (!isFinite(t) && data.length < limit) break
    }
    return all
  }

  function toCsv(rows: Record<string, any>[], headers: string[]) {
    const escapeCell = (v: any) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines: string[] = []
    lines.push(headers.join(','))
    if (rows.length === 0) {
      lines.push(['', '', '', ''].join(','))
    } else {
      for (const row of rows) {
        lines.push(headers.map(h => escapeCell(row[h])).join(','))
      }
    }
    return lines.join('\n')
  }

  async function exportAllIssuesCsv() {
    try {
      setBusy(true)

      // 1) Get all trucks
      const trucksRes = await fetch(`${API}/trucks`, { headers: authHeaders() })
      if (!trucksRes.ok) throw new Error(await trucksRes.text())
      const trucks: { id: number; number: string }[] = await trucksRes.json()

      // 2) For each truck, fetch reports (paged) and flatten defects
      const allRows: Record<string, any>[] = []
      for (const t of trucks) {
        const reports = await fetchAllReportsForTruck(t.id)
        for (const r of reports) {
          const createdAt = r?.created_at
          const defects = Array.isArray(r?.defects) ? r.defects : []
          for (const d of defects) {
            const issueDate = createdAt ? formatDateMDY(createdAt) : ''
            const issueText = d?.description ?? ''
            const resolvedDate = d?.resolved
              ? (d?.resolved_at ? formatDateMDY(d.resolved_at) : '')
              : 'Unresolved'
            allRows.push({
              'Truck': t.number ?? t.id,
              'Date of Issue': issueDate,
              'Issue': issueText,
              'Date Resolved / Status': resolvedDate,
            })
          }
        }
      }

      // 3) Build + download CSV (date-only, no time)
      const headers = ['Truck', 'Date of Issue', 'Issue', 'Date Resolved / Status']
      const csv = toCsv(allRows, headers)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const ts = formatDateMDY(new Date()) // cleaner filename date
      a.download = `all-trucks-issues-${ts}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err: any) {
      alert(err?.message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={exportAllIssuesCsv}
      disabled={busy}
      className="px-2 py-1 text-xs border rounded-lg disabled:opacity-50"
      title="Export all issues for all trucks"
    >
      {busy ? 'Exporting…' : 'Export All Issues'}
    </button>
  )
}
