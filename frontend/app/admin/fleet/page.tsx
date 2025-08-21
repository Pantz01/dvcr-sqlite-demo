// app/admin/fleet/page.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders } from '@/lib/api'
import * as XLSX from 'xlsx'

type Truck = {
  id: number
  number: string
  vin?: string | null
  active: boolean
}

type FleetMeta = {
  vin?: string
  eld?: string
  camera?: string
  year?: number | null
  make?: string
  model?: string
  fleet?: string
}

const LS_KEY = 'fleetMeta:v1'

type ParsedRow = {
  truckNumber: string
  meta: FleetMeta
}

export default function FleetPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <FleetInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function FleetInner() {
  const fileRef = useRef<HTMLInputElement>(null)

  const [trucks, setTrucks] = useState<Truck[]>([])
  const [metaByTruck, setMetaByTruck] = useState<Record<string, FleetMeta>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unmatchedCount, setUnmatchedCount] = useState(0)
  const [lastImport, setLastImport] = useState<string | null>(null)

  // UI state
  const [fleetFilter, setFleetFilter] = useState<string>('__all__')
  const [query, setQuery] = useState('')

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

  // Load saved meta (local)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) setMetaByTruck(JSON.parse(raw))
    } catch {}
  }, [])

  // Derived: fleet names for filter
  const fleets = useMemo(() => {
    const set = new Set<string>()
    for (const v of Object.values(metaByTruck)) {
      const f = (v?.fleet || '').trim()
      if (f) set.add(f)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [metaByTruck])

  // Rows (sorted, filtered, searchable)
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return trucks
      .slice()
      .sort((a, b) => a.number.localeCompare(b.number))
      .map(t => ({ truck: t, meta: metaByTruck[t.number] || {} }))
      .filter(({ meta, truck }) => {
        if (fleetFilter !== '__all__' && (meta.fleet || '') !== fleetFilter) return false
        if (!q) return true
        const hay = [
          truck.number,
          meta.vin,
          meta.eld,
          meta.camera,
          meta.make,
          meta.model,
          meta.fleet,
          String(meta.year ?? ''),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
  }, [trucks, metaByTruck, fleetFilter, query])

  /* ===== Import / Export / Save / Clear / Sync ===== */

  function triggerImport() { fileRef.current?.click() }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setLastImport(f.name)
    setLoading(true)
    setError(null)
    setUnmatchedCount(0)
    try {
      const parsed = await parseFileSmart(f)
      const { merged, unmatched } = applyParsedRows(parsed, trucks, metaByTruck)
      setMetaByTruck(merged)
      setUnmatchedCount(unmatched)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to parse file')
    } finally {
      setLoading(false)
      e.target.value = ''
    }
  }

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(metaByTruck))
      alert('Saved locally.')
    } catch {
      alert('Failed to save locally.')
    }
  }

  function clearLocal() {
    if (!confirm('Clear saved fleet info?')) return
    localStorage.removeItem(LS_KEY)
    setMetaByTruck({})
    setUnmatchedCount(0)
    setLastImport(null)
  }

  function exportCsv() {
    const headers = ['Truck Number','VIN','ELD Serial','Camera Serial','Year','Make','Model','Fleet Name']
    const lines = [headers.join(',')]
    for (const { truck, meta } of rows) {
      const cells = [
        truck.number,
        meta.vin || '',
        meta.eld || '',
        meta.camera || '',
        meta.year != null ? String(meta.year) : '',
        meta.make || '',
        meta.model || '',
        meta.fleet || '',
      ]
      lines.push(cells.map(csvCell).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'fleet-info.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function trySyncToServer() {
    try {
      const body = rows.map(({ truck, meta }) => ({
        truck_id: truck.id,
        vin: meta.vin ?? null,
        eld_serial: meta.eld ?? null,
        camera_serial: meta.camera ?? null,
        year: meta.year ?? null,
        make: meta.make ?? null,
        model: meta.model ?? null,
        fleet: meta.fleet ?? null,
      }))
      if (body.length === 0) { alert('No data to sync.'); return }
      const r = await fetch(`${API}/trucks/bulk-meta`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' } as any,
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        alert(`Sync failed (endpoint may not exist yet): ${txt || r.status}`)
        return
      }
      alert('Synced fleet info to server.')
    } catch (e: any) {
      alert(e?.message ?? 'Sync failed.')
    }
  }

  /* ===== Render ===== */

  return (
    <main className="p-6 space-y-4 max-w-4xl mx-auto">
      {/* Header + actions (compact) */}
      <div className="flex items-center flex-wrap gap-2 leading-tight">
        <h1 className="text-lg font-semibold">Fleet Information</h1>
        <div className="flex items-center gap-2">
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={triggerImport} title="Import CSV/XLSX">Import</button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={exportCsv} title="Download CSV">Export</button>
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={saveLocal} title="Save to this browser">Save</button>
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={clearLocal} title="Clear saved fleet info">Clear</button>
          <button className="px-2.5 py-1 text-[11px] border rounded-md" onClick={trySyncToServer} title="Try POST /trucks/bulk-meta">Sync</button>
        </div>
      </div>

      {/* tiny status line */}
      <div className="text-[11px] text-gray-600 h-4 flex items-center gap-2">
        {loading && <span>Parsing…</span>}
        {!loading && lastImport && <span>Imported: <b>{lastImport}</b></span>}
        {!loading && unmatchedCount > 0 && <span className="text-[11px] text-amber-700">• Unmatched rows: {unmatchedCount}</span>}
        {error && <span className="text-red-600">• {error}</span>}
      </div>

      {/* Filters (narrow) */}
      <div className="flex items-end gap-3">
        <label className="grid gap-1 text-xs">
          <span className="text-gray-600">Fleet</span>
          <select className="border rounded-md px-2 py-1 text-sm w-40" value={fleetFilter} onChange={(e) => setFleetFilter(e.target.value)}>
            <option value="__all__">All Fleets</option>
            {fleets.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-gray-600">Search</span>
          <input className="border rounded-md px-2 py-1 text-sm w-56" placeholder="Truck, VIN, serial, etc." value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {/* Read-only table (compact, fixed widths, truncation) */}
      <section className="border rounded-xl overflow-hidden">
        <div className="px-3 py-2 font-semibold border-b text-sm leading-tight">Fleet Inventory</div>
        <div className="overflow-auto">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col style={{ width: '90px' }} />   {/* Truck */}
              <col style={{ width: '180px' }} />  {/* VIN */}
              <col style={{ width: '150px' }} />  {/* ELD */}
              <col style={{ width: '150px' }} />  {/* Camera */}
              <col style={{ width: '70px' }} />   {/* Year */}
              <col style={{ width: '120px' }} />  {/* Make */}
              <col style={{ width: '130px' }} />  {/* Model */}
              <col style={{ width: '160px' }} />  {/* Fleet */}
            </colgroup>
            <thead className="bg-gray-50 text-xs">
              <tr>
                <th className="text-left px-2 py-1 whitespace-nowrap">Truck</th>
                <th className="text-left px-2 py-1 whitespace-nowrap">VIN</th>
                <th className="text-left px-2 py-1 whitespace-nowrap">ELD Serial</th>
                <th className="text-left px-2 py-1 whitespace-nowrap">Camera Serial</th>
                <th className="text-left px-2 py-1 whitespace-nowrap">Year</th>
                <th className="text-left px-2 py-1 whitespace-nowrap">Make</th>
                <th className="text-left px-2 py-1 whitespace-nowrap">Model</th>
                <th className="text-left px-2 py-1 whitespace-nowrap">Fleet Name</th>
              </tr>
            </thead>
            <tbody className="leading-tight">
              {rows.map(({ truck, meta }) => (
                <tr key={truck.id} className="border-t">
                  <td className="px-2 py-1 font-medium whitespace-nowrap">{truck.number}</td>
                  <td className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis" title={meta.vin || ''}>{display(meta.vin)}</td>
                  <td className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis" title={meta.eld || ''}>{display(meta.eld)}</td>
                  <td className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis" title={meta.camera || ''}>{display(meta.camera)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{meta.year ?? <span className="text-gray-400">—</span>}</td>
                  <td className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis" title={meta.make || ''}>{display(meta.make)}</td>
                  <td className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis" title={meta.model || ''}>{display(meta.model)}</td>
                  <td className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis" title={meta.fleet || ''}>{display(meta.fleet)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-2 text-xs text-gray-500">No rows match your filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

/* ====================== Parsing helpers ======================= */

async function parseFileSmart(file: File): Promise<ParsedRow[]> {
  const fromArray = await tryParseArrayBuffer(file).catch(() => [] as ParsedRow[])
  if (fromArray.length > 0) return fromArray
  const fromText = await tryParseText(file).catch(() => [] as ParsedRow[])
  return fromText
}

async function tryParseArrayBuffer(file: File): Promise<ParsedRow[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  return extractRows(wb)
}

async function tryParseText(file: File): Promise<ParsedRow[]> {
  const text = await file.text()
  const wb = XLSX.read(text, { type: 'string' })
  return extractRows(wb)
}

function extractRows(wb: XLSX.WorkBook): ParsedRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
  const out: ParsedRow[] = []
  for (const row of rows) {
    const truck = pickTruckCell(row)
    if (!truck) continue

    const meta: FleetMeta = {}
    meta.vin = pickString(row, vinKeys)
    meta.eld = pickString(row, eldKeys)
    meta.camera = pickString(row, camKeys)
    meta.year = toYear(pickString(row, yearKeys))
    meta.make = pickString(row, makeKeys)
    meta.model = pickString(row, modelKeys)
    meta.fleet = pickString(row, fleetKeys)

    out.push({ truckNumber: truck.value, meta: scrubMeta(meta) })
  }
  return out
}

function applyParsedRows(
  rows: ParsedRow[],
  trucks: Truck[],
  existing: Record<string, FleetMeta>
) {
  const merged = { ...existing }
  const truckNoSet = new Set(trucks.map(t => norm(t.number)))
  let unmatched = 0

  for (const r of rows) {
    const key = norm(r.truckNumber)
    if (truckNoSet.has(key)) {
      const canonical = trucks.find(t => norm(t.number) === key)!.number
      merged[canonical] = { ...(merged[canonical] ?? {}), ...scrubMeta(r.meta) }
    } else {
      unmatched++
    }
  }
  return { merged, unmatched }
}

/* ====================== Utilities ======================= */

const vinKeys = ['vin','vehicle identification number','vehicle id number','vehicle id']
const eldKeys = ['eld','eld serial','eld id','eld unit','eld number','peoplenet','omnitracs','geotab id']
const camKeys = ['camera','camera serial','camera id','dashcam','cam serial','cam id']
const yearKeys = ['year','model year','yr']
const makeKeys = ['make','manufacturer']
const modelKeys = ['model']
const fleetKeys = ['fleet','fleet name','division','location']
const truckKeys = ['truck number','truck','unit','vehicle','number','truck_no','unit number','truck id']

function norm(s: string) { return (s || '').trim().toLowerCase() }
function headerMatches(nk: string, synonyms: string[]) { return synonyms.some(sym => nk.includes(norm(sym))) }

function pickTruckCell(row: Record<string, any>): { key: string; value: string } | null {
  const keys = Object.keys(row)
  for (const k of keys) {
    const nk = norm(k)
    if (headerMatches(nk, truckKeys)) {
      const val = String(row[k]).trim()
      if (val) return { key: k, value: val }
    }
  }
  for (const k of keys) {
    const raw = String(row[k]).trim()
    if (raw && /^[A-Za-z0-9-]+$/.test(raw) && !/[,$]/.test(raw)) {
      return { key: k, value: raw }
    }
  }
  return null
}

function pickString(row: Record<string, any>, synonyms: string[]): string | undefined {
  const keys = Object.keys(row)
  for (const k of keys) {
    const nk = norm(k)
    if (headerMatches(nk, synonyms)) {
      const v = String(row[k]).trim()
      return v || undefined
    }
  }
  return undefined
}

function toYear(v: any): number | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = parseInt(s, 10)
  if (!Number.isFinite(n)) return null
  if (n >= 1980 && n <= 2100) return n
  const n2 = parseInt(s.replace(/\D/g, ''), 10)
  if (Number.isFinite(n2) && n2 >= 1980 && n2 <= 2100) return n2
  return null
}

function scrubMeta(m: FleetMeta): FleetMeta {
  const copy: FleetMeta = {}
  if (m.vin) copy.vin = m.vin
  if (m.eld) copy.eld = m.eld
  if (m.camera) copy.camera = m.camera
  if (m.year != null) copy.year = m.year
  if (m.make) copy.make = m.make
  if (m.model) copy.model = m.model
  if (m.fleet) copy.fleet = m.fleet
  return copy
}

function csvCell(v: any) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function display(v?: string) {
  return v && v.trim() ? v : <span className="text-gray-400">—</span>
}
