// app/admin/services/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders } from '@/lib/api'

type Truck = {
  id: number
  number: string
  vin?: string | null
  active: boolean
}

type ServiceType = 'oil' | 'chassis' | 'general' | 'major' | 'driver'

type Service = {
  id: number
  truck_id: number
  service_type: ServiceType | string
  odometer: number
  notes?: string | null
  created_at: string
}

type Row = Service & { truckNumber: string }

export default function ServiceHistoryPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <ServiceHistoryInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function ServiceHistoryInner() {
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [truckId, setTruckId] = useState<number | 0>(0) // 0 = All
  const [svcType, setSvcType] = useState<'all' | ServiceType>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      // 1) trucks
      const tr = await fetch(`${API}/trucks`, { headers: authHeaders() })
      if (!tr.ok) throw new Error(await tr.text())
      const truckList: Truck[] = await tr.json()
      setTrucks(truckList)

      // 2) services per truck (aggregated)
      const all: Row[] = []
      for (const t of truckList) {
        const r = await fetch(`${API}/trucks/${t.id}/service`, { headers: authHeaders() })
        if (!r.ok) continue
        const list: Service[] = await r.json()
        for (const s of list) {
          all.push({ ...s, truckNumber: t.number })
        }
      }
      // newest first
      all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setRows(all)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load service history')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r => {
      if (truckId && r.truck_id !== truckId) return false
      if (svcType !== 'all' && r.service_type !== svcType) return false
      if (!q) return true
      const hay = [
        r.truckNumber,
        String(r.odometer ?? ''),
        r.service_type,
        r.notes || '',
        r.created_at,
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [rows, truckId, svcType, query])

  function exportCsv() {
    const headers = ['Date', 'Truck', 'Type', 'Odometer', 'Notes']
    const lines = [headers.join(',')]
    for (const r of filtered) {
      const cells = [
        formatDateMDY(r.created_at),
        r.truckNumber,
        niceType(r.service_type),
        String(r.odometer ?? ''),
        r.notes?.replace(/\r?\n/g, ' ').trim() || '',
      ]
      lines.push(cells.map(csvCell).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'service-history.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <main className="p-6 space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Service History</h1>
        <div className="flex items-center gap-2">
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={loadAll} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={exportCsv} disabled={filtered.length === 0}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-end gap-3">
        <label className="grid gap-1 text-xs">
          <span className="text-gray-600">Truck</span>
          <select
            className="border rounded-md px-2 py-1 text-sm w-44"
            value={truckId}
            onChange={(e) => setTruckId(parseInt(e.target.value, 10))}
          >
            <option value={0}>All Trucks</option>
            {trucks.map(t => (
              <option key={t.id} value={t.id}>{t.number}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs">
          <span className="text-gray-600">Type</span>
          <select
            className="border rounded-md px-2 py-1 text-sm w-48"
            value={svcType}
            onChange={(e) => setSvcType(e.target.value as any)}
          >
            <option value="all">All</option>
            <option value="oil">Oil</option>
            <option value="chassis">Chassis</option>
            <option value="general">General Maintenance</option>
            <option value="major">Major Repairs</option>
            <option value="driver">Driver Damage</option>
          </select>
        </label>

        <label className="grid gap-1 text-xs">
          <span className="text-gray-600">Search</span>
          <input
            className="border rounded-md px-2 py-1 text-sm w-64"
            placeholder="Notes, truck, type…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <div className="text-xs text-gray-600 ml-auto">
          {loading ? 'Loading…' : `${filtered.length} / ${rows.length} records`}
          {error ? <span className="text-red-600"> • {error}</span> : null}
        </div>
      </div>

      {/* Table */}
      <section className="border rounded-xl overflow-hidden">
        <div className="px-3 py-2 font-semibold border-b text-sm">Records</div>
        <div className="overflow-auto">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col style={{ width: '140px' }} /> {/* Date */}
              <col style={{ width: '120px' }} /> {/* Truck */}
              <col style={{ width: '170px' }} /> {/* Type */}
              <col style={{ width: '120px' }} /> {/* Odometer */}
              <col />                             {/* Notes */}
            </colgroup>
            <thead className="bg-gray-50 text-xs">
              <tr>
                <th className="text-left px-2 py-1">Date</th>
                <th className="text-left px-2 py-1">Truck</th>
                <th className="text-left px-2 py-1">Type</th>
                <th className="text-left px-2 py-1">Odometer</th>
                <th className="text-left px-2 py-1">Notes</th>
              </tr>
            </thead>
            <tbody className="leading-tight">
              {filtered.map(r => (
                <tr key={`${r.id}-${r.truck_id}`} className="border-t align-top">
                  <td className="px-2 py-1 whitespace-nowrap">{formatDateMDY(r.created_at)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.truckNumber}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{niceType(r.service_type)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.odometer ?? 0}</td>
                  <td className="px-2 py-1">
                    <div className="whitespace-pre-wrap break-words">{r.notes?.trim() || <span className="text-gray-400">—</span>}</div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-2 text-xs text-gray-500">No records.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

/* ===== helpers ===== */

function niceType(s: string) {
  switch (s) {
    case 'oil': return 'Oil'
    case 'chassis': return 'Chassis'
    case 'general': return 'General Maintenance'
    case 'major': return 'Major Repairs'
    case 'driver': return 'Driver Damage'
    default: return s || '—'
  }
}

function formatDateMDY(input?: string | number | Date | null) {
  if (!input) return ''
  const d = new Date(input)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`
}

function csvCell(v: any) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
