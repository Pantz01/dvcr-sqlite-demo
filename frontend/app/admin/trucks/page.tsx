'use client'

import { useEffect, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import { API, authHeaders, jsonHeaders } from '@/lib/api'
import Link from 'next/link'

type Truck = {
  id: number
  number: string
  vin?: string | null
  active: boolean
  odometer: number
}

type Report = {
  id: number
  truck: Truck
  created_at: string
  odometer?: number | null
  status: string
  summary?: string | null
}

export default function DriverTrucksPage() {
  return (
    <RequireAuth>
      <DriverInner />
    </RequireAuth>
  )
}

function DriverInner() {
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [truckId, setTruckId] = useState<number | null>(null)

  const [odometer, setOdometer] = useState<number>(0)
  const [summary, setSummary] = useState('')
  const [issues, setIssues] = useState('') // one per line

  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadTrucks()
  }, [])

  async function loadTrucks() {
    setError(null)
    const r = await fetch(`${API}/trucks`, { headers: authHeaders() })
    if (!r.ok) { setError(await r.text()); return }
    const list: Truck[] = await r.json()
    setTrucks(list.filter(t => t.active))
    if (!truckId && list.length) setTruckId(list[0].id)
  }

  async function submit() {
    setError(null)
    setDone(null)

    if (!truckId) { setError('Select a truck.'); return }
    if (!odometer || odometer < 0) { setError('Enter a valid odometer.'); return }

    setBusy(true)
    try {
      // 1) create the report
      const r = await fetch(`${API}/trucks/${truckId}/reports`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ odometer, summary }),
      })
      if (!r.ok) { throw new Error(await r.text()) }
      const rep: Report = await r.json()

      // 2) create issues (defects) one per non-empty line
      const lines = issues.split('\n').map(s => s.trim()).filter(Boolean)
      for (const line of lines) {
        const d = await fetch(`${API}/reports/${rep.id}/defects`, {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({
            component: 'general',
            severity: 'minor',
            description: line,
          }),
        })
        if (!d.ok) throw new Error(await d.text())
      }

      setDone(rep)
      // reset form
      setOdometer(0)
      setSummary('')
      setIssues('')
    } catch (e: any) {
      setError(e?.message || 'Failed to submit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Truck Report</h1>

      <div className="border rounded-2xl p-4 space-y-3 max-w-3xl">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-gray-600">Truck</span>
            <select
              className="border p-2 rounded-xl"
              value={truckId ?? ''}
              onChange={(e) => setTruckId(parseInt(e.target.value || '0', 10) || null)}
            >
              {trucks.map(t => (
                <option key={t.id} value={t.id}>
                  {t.number} {t.vin ? `· ${t.vin}` : ''}
                </option>
              ))}
              {trucks.length === 0 && <option value="">No active trucks</option>}
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-gray-600">Odometer</span>
            <input
              type="number"
              className="border p-2 rounded-xl"
              placeholder="e.g. 123456"
              value={odometer}
              onChange={(e) => setOdometer(parseInt(e.target.value || '0', 10))}
            />
          </label>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="text-gray-600">Summary (optional)</span>
          <input
            className="border p-2 rounded-xl"
            placeholder="Short summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-gray-600">Issues (one per line)</span>
          <textarea
            className="border p-2 rounded-xl h-40"
            placeholder={`Example:\nLeft headlight out\nAir leak at gladhand\nWorn wiper blades`}
            value={issues}
            onChange={(e) => setIssues(e.target.value)}
          />
        </label>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex items-center gap-3">
          <button
            className="border rounded-xl px-4 py-2"
            disabled={busy || !truckId}
            onClick={submit}
          >
            {busy ? 'Submitting…' : 'Submit report'}
          </button>
          {done && (
            <span className="text-sm text-green-700">
              Report submitted.{' '}
              <Link
                href={`/admin/trucks/${done.truck.id}`}
                className="underline"
                title="Open in admin (managers/admins only)"
              >
                View in Admin
              </Link>
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-600 max-w-3xl">
        Tip: put each issue on its own line. You can edit/resolve issues later from the admin screen.
      </p>
    </main>
  )
}
