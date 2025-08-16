'use client'

import { useEffect, useMemo, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

type Truck = {
  id: number
  number: string
  vin?: string | null
  active: boolean
  odometer: number
}

type Defect = {
  id: number
  description?: string | null
  resolved: boolean
}

type Report = {
  id: number
  created_at: string
  odometer?: number | null
  status: 'OPEN' | 'CLOSED' | string
  summary?: string | null
  defects?: Defect[]
}

export default function DriverTrucksPage() {
  return (
    <RequireAuth>
      <DriverTrucksInner />
    </RequireAuth>
  )
}

function DriverTrucksInner() {
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [selected, setSelected] = useState<Truck | null>(null)
  const [activeReport, setActiveReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [odo, setOdo] = useState<number>(0)
  const [issue, setIssue] = useState('')

  useEffect(() => { loadTrucks() }, [])

  async function loadTrucks() {
    const r = await fetch(`${API}/trucks`, { headers: authHeaders() })
    if (!r.ok) { alert(await r.text()); return }
    setTrucks(await r.json())
  }

  async function selectTruck(t: Truck) {
    setSelected(t)
    setActiveReport(null)
    setOdo(t.odometer ?? 0)
    setIssue('')
    setLoading(true)
    // fetch most recent OPEN (or latest) report
    const r = await fetch(`${API}/trucks/${t.id}/reports`, { headers: authHeaders() })
    setLoading(false)
    if (!r.ok) { alert(await r.text()); return }
    const list: Report[] = await r.json()
    const open = list.find(x => x.status === 'OPEN') || list[0] || null
    if (open) {
      const rr = await fetch(`${API}/reports/${open.id}`, { headers: authHeaders() })
      setActiveReport(rr.ok ? await rr.json() : open)
    }
  }

  async function ensureReport() {
    if (!selected) return null
    if (activeReport) return activeReport
    // create a simple report (type kept for backend compatibility)
    const r = await fetch(`${API}/trucks/${selected.id}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ type: 'pre', odometer: odo || selected.odometer, summary: '' }),
    })
    if (!r.ok) { alert(await r.text()); return null }
    const created: Report = await r.json()
    // hydrate
    const rr = await fetch(`${API}/reports/${created.id}`, { headers: authHeaders() })
    const full = rr.ok ? await rr.json() : created
    setActiveReport(full)
    return full
  }

  async function saveOdometer() {
    if (!selected) return
    setBusy(true)
    // bump truck odometer via a service record is not needed; reports already update truck odo in backend.
    // we’ll just make sure the current report captures this odometer
    const rep = await ensureReport()
    if (rep) {
      const r = await fetch(`${API}/reports/${rep.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ odometer: odo }),
      })
      if (!r.ok) { alert(await r.text()); setBusy(false); return }
      // reload report
      const rr = await fetch(`${API}/reports/${rep.id}`, { headers: authHeaders() })
      if (rr.ok) setActiveReport(await rr.json())
    }
    setBusy(false)
  }

  async function addIssue() {
    const text = issue.trim()
    if (!selected || !text) return
    const rep = await ensureReport()
    if (!rep) return
    const r = await fetch(`${API}/reports/${rep.id}/defects`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ component: 'general', severity: 'minor', description: text }),
    })
    if (!r.ok) { alert(await r.text()); return }
    setIssue('')
    // reload
    const rr = await fetch(`${API}/reports/${rep.id}`, { headers: authHeaders() })
    if (rr.ok) setActiveReport(await rr.json())
  }

  const defects = useMemo(() => activeReport?.defects || [], [activeReport])

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Trucks</h1>

      {/* Truck picker */}
      <div className="border rounded-2xl overflow-hidden grid md:grid-cols-3">
        <div className="border-r">
          <div className="p-3 font-semibold">Select Truck</div>
          <div className="max-h-[60vh] overflow-auto divide-y">
            {trucks.map(t => (
              <button
                key={t.id}
                className={`w-full text-left p-3 hover:bg-gray-50 ${selected?.id === t.id ? 'bg-gray-50' : ''}`}
                onClick={() => selectTruck(t)}
              >
                <div className="font-medium">{t.number}</div>
                <div className="text-xs text-gray-600">VIN {t.vin || '—'} · Odo {t.odometer ?? 0}</div>
              </button>
            ))}
            {trucks.length === 0 && <div className="p-3 text-sm text-gray-500">No trucks.</div>}
          </div>
        </div>

        <div className="p-4 md:col-span-2 space-y-4">
          {!selected ? (
            <div className="text-sm text-gray-500">Choose a truck on the left.</div>
          ) : (
            <>
              <div className="grid sm:grid-cols-3 gap-3 items-end">
                <label className="grid gap-1 text-sm">
                  <span className="text-gray-600">Odometer</span>
                  <input
                    type="number"
                    className="border p-2 rounded-xl"
                    value={odo}
                    onChange={(e) => setOdo(parseInt(e.target.value || '0', 10))}
                  />
                </label>
                <button className="border rounded-xl px-3 py-2" disabled={busy} onClick={saveOdometer}>
                  {busy ? 'Saving…' : 'Save odometer'}
                </button>
              </div>

              <div className="grid sm:grid-cols-5 gap-2">
                <input
                  className="border p-2 rounded-xl sm:col-span-4"
                  placeholder="Add an issue (e.g., brake light out)"
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                />
                <button className="border rounded-xl p-2" onClick={addIssue}>Add issue</button>
              </div>

              <div className="rounded-xl border divide-y">
                <div className="p-3 font-semibold">Current Report</div>
                {loading ? (
                  <div className="p-3 text-sm text-gray-500">Loading…</div>
                ) : !activeReport ? (
                  <div className="p-3 text-sm text-gray-500">No report yet. Add odometer or an issue to start one.</div>
                ) : (
                  <>
                    <div className="p-3 text-sm text-gray-700">
                      Created {new Date(activeReport.created_at).toLocaleString()} · Odo {activeReport.odometer ?? '—'} · {activeReport.status}
                    </div>
                    {defects.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500">No issues listed.</div>
                    ) : (
                      defects.map(d => (
                        <div key={d.id} className="p-3 text-sm">
                          <div className="font-medium">{d.description || '(no description)'}</div>
                          <div className="text-xs text-gray-600">{d.resolved ? 'Resolved' : 'Open'}</div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
