// app/admin/costs/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders } from '@/lib/api'
import * as XLSX from 'xlsx'
import { Upload, Save, Trash2, Download } from 'lucide-react'

type Truck = {
  id: number
  number: string
  active: boolean
  vin?: string | null
  odometer?: number | null
}

type ParsedRow = {
  truckNumber: string
  ytdCost: number
}

const LS_KEY = 'ytdCosts:v1'

export default function CostsPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <CostsInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function CostsInner() {
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Map truckNumber -> cost
  const [ytdByTruckNo, setYtdByTruckNo] = useState<Record<string, number>>({})
  // Any rows in the upload we couldn't match to an existing truck number
  const [unmatched, setUnmatched] = useState<ParsedRow[]>([])

  // Load trucks
  useEffect(() => {
    ;(async () => {
      setError(null)
      try {
        const r = await fetch(`${API}/trucks`, { headers: authHeaders() })
        if (!r.ok) throw new Error(await r.text())
        const list: Truck[] = await r.json()
        setTrucks(list)
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load trucks')
      }
    })()
  }, [])

  // Load saved costs (local)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) setYtdByTruckNo(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [])

  const totalCost = useMemo(
    () => Object.values(ytdByTruckNo).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0),
    [ytdByTruckNo]
  )

  // Merge parsed rows into state and compute unmatched
  function applyParsedRows(rows: ParsedRow[]) {
    const byNo = { ...ytdByTruckNo }
    const truckNoSet = new Set(trucks.map(t => norm(t.number)))
    const unmatchedRows: ParsedRow[] = []

    for (const r of rows) {
      const key = norm(r.truckNumber)
      if (truckNoSet.has(key)) {
        // use original case from your trucks list for display consistency
        const original = trucks.find(t => norm(t.number) === key)?.number ?? r.truckNumber
        byNo[original] = r.ytdCost
      } else {
        unmatchedRows.push(r)
      }
    }

    setYtdByTruckNo(byNo)
    setUnmatched(unmatchedRows)
  }

  // File upload handler
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setLoading(true)
    setError(null)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })

      const parsed: ParsedRow[] = []
      for (const row of rows) {
        const truckNumber = pickTruckNumber(row)
        const ytdCost = pickCost(row)
        if (truckNumber && Number.isFinite(ytdCost)) {
          parsed.push({ truckNumber, ytdCost })
        }
      }

      if (parsed.length === 0) {
        // Try CSV-as-text (some CSVs read better via text path)
        const text = await f.text().catch(() => '')
        if (text) {
          const wb2 = XLSX.read(text, { type: 'string' })
          const ws2 = wb2.Sheets[wb2.SheetNames[0]]
          const rows2 = XLSX.utils.sheet_to_json<Record<string, any>>(ws2, { defval: '' })
          for (const row of rows2) {
            const truckNumber = pickTruckNumber(row)
            const ytdCost = pickCost(row)
            if (truckNumber && Number.isFinite(ytdCost)) {
              parsed.push({ truckNumber, ytdCost })
            }
          }
        }
      }

      if (parsed.length === 0) {
        alert('Could not find columns for Truck/Number and Cost/YTD in the uploaded file.')
        return
      }

      applyParsedRows(parsed)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to parse file')
    } finally {
      setLoading(false)
      e.target.value = '' // reset
    }
  }

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(ytdByTruckNo))
      alert('Saved locally.')
    } catch {
      alert('Failed to save locally.')
    }
  }

  function clearLocal() {
    if (!confirm('Clear saved YTD costs?')) return
    localStorage.removeItem(LS_KEY)
    setYtdByTruckNo({})
    setUnmatched([])
  }

  function exportNormalizedCsv() {
    // Produce a simple two-column CSV: Truck Number, YTD Cost
    const headers = ['Truck Number', 'YTD Cost']
    const lines = [headers.join(',')]
    for (const [no, cost] of Object.entries(ytdByTruckNo)) {
      lines.push(`${csvCell(no)},${csvCell(cost)}`)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ytd-costs-normalized.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // Optional: If you add a backend endpoint, this will try to sync
  // Expected body: [{ truck_id, ytd_cost }]
  async function trySyncToServer() {
    try {
      const byId: { truck_id: number; ytd_cost: number }[] = []
      for (const t of trucks) {
        const cost = ytdByTruckNo[t.number]
        if (Number.isFinite(cost)) byId.push({ truck_id: t.id, ytd_cost: cost })
      }
      if (byId.length === 0) {
        alert('No costs to sync.')
        return
      }
      const r = await fetch(`${API}/costs/bulk-ytd`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        } as any,
        body: JSON.stringify(byId),
      })
      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        alert(`Sync failed (endpoint may not exist yet): ${txt || r.status}`)
        return
      }
      alert('Synced YTD costs to server.')
    } catch (e: any) {
      alert(e?.message ?? 'Sync failed.')
    }
  }

  const rowsForDisplay = useMemo(() => {
    // show all trucks; if a truck has no cost, display 0 or empty?
    // We'll show blank for clarity.
    const arr = trucks
      .slice()
      .sort((a, b) => a.number.localeCompare(b.number))
      .map(t => ({
        id: t.id,
        number: t.number,
        cost: ytdByTruckNo[t.number],
      }))
    return arr
  }, [trucks, ytdByTruckNo])

  return (
    <main className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Maintenance Cost Tracker (YTD)</h1>
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1 text-[11px] border rounded-md inline-flex items-center gap-1"
            onClick={exportNormalizedCsv}
            title="Download a normalized CSV of the current YTD table"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            className="px-2.5 py-1 text-[11px] border rounded-md inline-flex items-center gap-1"
            onClick={saveLocal}
            title="Save to this browser"
          >
            <Save size={14} /> Save
          </button>
          <button
            className="px-2.5 py-1 text-[11px] border rounded-md inline-flex items-center gap-1"
            onClick={clearLocal}
            title="Clear saved YTD costs"
          >
            <Trash2 size={14} /> Clear
          </button>
          <button
            className="px-2.5 py-1 text-[11px] border rounded-md inline-flex items-center gap-1"
            onClick={trySyncToServer}
            title="Try to POST to /costs/bulk-ytd"
          >
            Sync Server
          </button>
        </div>
      </div>

      {/* Upload */}
      <section className="border rounded-xl p-3">
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm">Upload YTD Spreadsheet</div>
          <label className="cursor-pointer inline-flex items-center gap-2 text-[12px] border rounded-md px-2.5 py-1">
            <Upload size={14} />
            <span>Choose file</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={onFile}
              disabled={loading}
            />
          </label>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          Expected columns (auto-detected): <b>Truck Number</b> and <b>YTD Cost</b>. Accepted synonyms:
          <i> truck, number, unit, vehicle</i> and <i> ytd, cost, maintenance cost, ytd cost</i>.
        </p>
        {loading && <div className="text-xs text-gray-600 mt-2">Parsing…</div>}
        {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      </section>

      {/* Summary */}
      <div className="text-sm text-gray-700 flex flex-wrap items-center gap-2">
        <span>Total trucks: <b>{trucks.length}</b></span>
        <span className="opacity-60">•</span>
        <span>With YTD data: <b>{Object.keys(ytdByTruckNo).length}</b></span>
        <span className="opacity-60">•</span>
        <span>Total YTD: <b>${fmtMoney(totalCost)}</b></span>
      </div>

      {/* Table */}
      <section className="border rounded-xl overflow-hidden">
        <div className="px-3 py-2 font-semibold border-b text-sm">YTD by Truck</div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs">
              <tr>
                <th className="text-left p-2 w-40">Truck</th>
                <th className="text-right p-2 w-40">YTD Cost</th>
              </tr>
            </thead>
            <tbody>
              {rowsForDisplay.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.number}</td>
                  <td className="p-2 text-right">{r.cost != null ? `$${fmtMoney(r.cost)}` : <span className="text-gray-400">—</span>}</td>
                </tr>
              ))}
              {rowsForDisplay.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-3 text-xs text-gray-500">No trucks found.</td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-gray-50 text-xs">
              <tr>
                <td className="p-2 font-medium text-right">Total</td>
                <td className="p-2 text-right font-semibold">${fmtMoney(totalCost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Unmatched */}
      {unmatched.length > 0 && (
        <section className="border rounded-xl p-3">
          <div className="font-medium text-sm mb-2">Unmatched from Upload</div>
          <p className="text-xs text-gray-600 mb-2">
            These rows didn’t match any existing truck number in your system. Fix the truck number in your spreadsheet or add the truck, then re-upload.
          </p>
          <div className="max-h-[30vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2">Truck (from file)</th>
                  <th className="text-right p-2">YTD</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((u, i) => (
                  <tr key={`${u.truckNumber}-${i}`} className="border-t">
                    <td className="p-2">{u.truckNumber}</td>
                    <td className="p-2 text-right">${fmtMoney(u.ytdCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  )
}

/* =============== helpers =============== */

function norm(s: string) {
  return (s || '').trim().toLowerCase()
}

function parseMoney(v: any): number | null {
  if (v == null) return null
  const s = String(v).replace(/[\s,$]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function csvCell(v: any) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// heuristics to find the truck-number column
function pickTruckNumber(row: Record<string, any>): string | null {
  const keys = Object.keys(row)
  // prefer exact-ish names first
  const candidates = [
    'truck number', 'truck', 'number', 'unit', 'vehicle', 'truck_no', 'trucknum', 'unit number'
  ]
  for (const k of keys) {
    if (candidates.includes(norm(k))) return String(row[k]).trim()
  }
  // fallback: first column that looks alphanum without spaces
  for (const k of keys) {
    const val = String(row[k]).trim()
    if (val && /^[\w-]+$/i.test(val)) return val
  }
  return null
}

// heuristics to find a YTD cost column
function pickCost(row: Record<string, any>): number | null {
  const keys = Object.keys(row)
  const candidates = [
    'ytd cost', 'ytd', 'maintenance cost', 'cost', 'amount', 'total', 'ytd_cost'
  ]
  for (const k of keys) {
    if (candidates.includes(norm(k))) {
      const n = parseMoney(row[k])
      if (n != null) return n
    }
  }
  // fallback: first numeric-ish column with $/comma/decimal
  for (const k of keys) {
    const n = parseMoney(row[k])
    if (n != null) return n
  }
  return null
}
