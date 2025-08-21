// app/admin/costs/page.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders } from '@/lib/api'
import * as XLSX from 'xlsx'

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
  const fileRef = useRef<HTMLInputElement>(null)

  const [trucks, setTrucks] = useState<Truck[]>([])
  const [ytdByTruckNo, setYtdByTruckNo] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unmatchedCount, setUnmatchedCount] = useState(0)
  const [lastImport, setLastImport] = useState<string | null>(null)

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
    } catch {}
  }, [])

  const totalCost = useMemo(
    () => Object.values(ytdByTruckNo).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0),
    [ytdByTruckNo]
  )

  const rowsForDisplay = useMemo(() => {
    return trucks
      .slice()
      .sort((a, b) => a.number.localeCompare(b.number))
      .map(t => ({
        id: t.id,
        number: t.number,
        cost: ytdByTruckNo[t.number],
      }))
  }, [trucks, ytdByTruckNo])

  /* ===== Import (compact) ===== */
  function triggerImport() {
    fileRef.current?.click()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setLastImport(f.name)
    setLoading(true)
    setError(null)
    setUnmatchedCount(0)
    try {
      const parsed = await parseFileSmart(f)
      const { matched, unmatched } = applyParsedRows(parsed, trucks, ytdByTruckNo)
      setYtdByTruckNo(matched)
      setUnmatchedCount(unmatched)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to parse file')
    } finally {
      setLoading(false)
      e.target.value = ''
    }
  }

  /* ===== Actions ===== */
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
    setUnmatchedCount(0)
    setLastImport(null)
  }

  function exportNormalizedCsv() {
    const headers = ['Truck Number', 'YTD Cost']
    const lines = [headers.join(',')]

    for (const r of rowsForDisplay) {
      const val =
        typeof r.cost === 'number' && Number.isFinite(r.cost) ? r.cost.toFixed(2) : ''
      lines.push(`${csvCell(r.number)},${val}`)
    }

    lines.push('')
    lines.push(`${csvCell('YTD Total')},${totalCost.toFixed(2)}`)

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ytd-costs.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

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

  return (
    <main className="p-6 space-y-4">
      {/* Header with LEFT-aligned actions */}
      <div className="flex items-center flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Maintenance Costs</h1>
        <div className="flex items-center gap-2">
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={triggerImport} title="Import CSV/XLSX">
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={onFile}
          />
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={exportNormalizedCsv} title="Download CSV">
            Export
          </button>
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={saveLocal} title="Save to this browser">
            Save
          </button>
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={clearLocal} title="Clear saved YTD costs">
            Clear
          </button>
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={trySyncToServer} title="Try to POST to /costs/bulk-ytd">
            Sync
          </button>
        </div>
      </div>

      {/* tiny status line */}
      <div className="text-[11px] text-gray-600 h-4 flex items-center gap-2">
        {loading && <span>Parsing…</span>}
        {!loading && lastImport && <span>Imported: <b>{lastImport}</b></span>}
        {!loading && unmatchedCount > 0 && (
          <span className="text-[11px] text-amber-700">
            • Unmatched rows: {unmatchedCount}
          </span>
        )}
        {error && <span className="text-red-600">• {error}</span>}
      </div>

      {/* Narrow, left-aligned table */}
      <section className="border rounded-xl overflow-hidden max-w-xl">
        <div className="px-3 py-2 font-semibold border-b text-sm">Year-to-Date Costs</div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs">
              <tr>
                <th className="text-left px-2 py-1.5 w-40">Truck</th>
                <th className="text-right px-2 py-1.5 w-40">YTD Cost</th>
              </tr>
            </thead>
            <tbody>
              {rowsForDisplay.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="px-2 py-1.5">{r.number}</td>
                  <td className="px-2 py-1.5 text-right">
                    {typeof r.cost === 'number' && Number.isFinite(r.cost)
                      ? `$${fmtMoney(r.cost)}`
                      : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
              {rowsForDisplay.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-2 py-2 text-xs text-gray-500">No trucks found.</td>
                </tr>
              )}
            </tbody>
            {/* Big, bold YTD Total */}
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={2} className="px-2 py-3 text-right">
                  <span className="text-sm text-gray-700 mr-2">YTD Total:</span>
                  <span className="text-lg font-extrabold">${fmtMoney(totalCost)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </main>
  )
}

/* =============== parsing helpers =============== */

async function parseFileSmart(file: File): Promise<ParsedRow[]> {
  const parsedFromArray = await tryParseArrayBuffer(file).catch(() => [] as ParsedRow[])
  if (parsedFromArray.length > 0) return parsedFromArray
  const parsedFromText = await tryParseText(file).catch(() => [] as ParsedRow[])
  return parsedFromText
}

async function tryParseArrayBuffer(file: File): Promise<ParsedRow[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  return extractRowsFromWorkbook(wb)
}

async function tryParseText(file: File): Promise<ParsedRow[]> {
  const text = await file.text()
  const wb = XLSX.read(text, { type: 'string' })
  return extractRowsFromWorkbook(wb)
}

function extractRowsFromWorkbook(wb: XLSX.WorkBook): ParsedRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
  const parsed: ParsedRow[] = []
  for (const row of rows) {
    const t = pickTruckCell(row)
    if (!t) continue
    const y = pickCostCell(row, t.key, t.value)
    if (y != null && Number.isFinite(y)) {
      parsed.push({ truckNumber: t.value, ytdCost: y })
    }
  }
  return parsed
}

function applyParsedRows(
  rows: ParsedRow[],
  trucks: Truck[],
  existing: Record<string, number>
) {
  const byNo = { ...existing }
  const truckNoSet = new Set(trucks.map(t => norm(t.number)))
  let unmatched = 0

  for (const r of rows) {
    const key = norm(r.truckNumber)
    if (truckNoSet.has(key)) {
      const original = trucks.find(t => norm(t.number) === key)?.number ?? r.truckNumber
      byNo[original] = r.ytdCost
    } else {
      unmatched++
    }
  }
  return { matched: byNo, unmatched }
}

/* =============== small utilities =============== */

function norm(s: string) {
  return (s || '').trim().toLowerCase()
}

function parseMoney(v: any): number | null {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
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

/* ---- smarter detection helpers ---- */

function pickTruckCell(row: Record<string, any>): { key: string; value: string } | null {
  const keys = Object.keys(row)
  // Prefer headers that look like truck/unit/vehicle
  for (const k of keys) {
    const nk = norm(k)
    if (/(^|[^a-z])(truck|unit|vehicle)([^a-z]|$)/.test(nk)) {
      const val = String(row[k]).trim()
      if (val) return { key: k, value: val }
    }
  }
  // Next: generic "number"/"id"/"no"
  for (const k of keys) {
    const nk = norm(k)
    if (/(^|[^a-z])(number|id|no\.?)([^a-z]|$)/.test(nk)) {
      const val = String(row[k]).trim()
      if (val) return { key: k, value: val }
    }
  }
  // Fallback: first ID-looking cell (alphanum/hyphen, not currency)
  for (const k of keys) {
    const raw = String(row[k]).trim()
    if (raw && /^[A-Za-z0-9-]+$/.test(raw) && !/[,$]/.test(raw)) {
      return { key: k, value: raw }
    }
  }
  return null
}

function pickCostCell(
  row: Record<string, any>,
  truckKey: string,
  truckVal: string
): number | null {
  const keys = Object.keys(row).filter(k => k !== truckKey)
  const truckNum = parseMoney(truckVal)

  // Strong header match: "ytd" plus ("cost" | "total" | "amount")
  for (const k of keys) {
    const nk = norm(k)
    const hasYtd = /\bytd\b/.test(nk) || nk.includes('year')
    const hasMoneyWord = /\bcost\b/.test(nk) || /\btotal\b/.test(nk) || /\bamount\b/.test(nk)
    if (hasYtd && hasMoneyWord) {
      const n = parseMoney(row[k])
      if (n != null) return n
    }
  }

  // Any header with money word
  for (const k of keys) {
    const nk = norm(k)
    if (/\bcost\b|\bamount\b|\btotal\b/.test(nk)) {
      const n = parseMoney(row[k])
      if (n != null) return n
    }
  }

  // Currency-looking cell
  for (const k of keys) {
    const raw = String(row[k])
    if (/[,$]/.test(raw)) {
      const n = parseMoney(raw)
      if (n != null) return n
    }
  }

  // Largest numeric value that isn't the truck number
  let best: number | null = null
  for (const k of keys) {
    const n = parseMoney(row[k])
    if (n == null) continue
    if (truckNum != null && n === truckNum) continue
    if (best == null || n > best) best = n
  }
  return best
}
