// app/reports/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'
import { useSearchParams } from 'next/navigation'

type Truck = {
  id: number
  number: string
  vin?: string | null
  active: boolean
  odometer: number
}

type Note = {
  id: number
  text: string
  created_at: string
  author?: { name?: string }
}

type Defect = {
  id: number
  description?: string | null
  resolved: boolean
  resolved_at?: string | null
  component?: string | null
  severity?: string | null
}

type Report = {
  id: number
  truck_id: number
  created_at: string
  odometer?: number | null
  status: 'OPEN' | 'CLOSED' | string
  summary?: string | null
  type: 'pre' | 'post' | string
  defects?: Defect[]
  notes?: Note[]
}

/* ---- tiny date helper (M-D-YYYY) ---- */
function formatDateMDY(input?: string | number | Date | null) {
  if (!input) return ''
  const d = new Date(input)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`
}

/* Flattened issue row: one per defect, carrying its report context + notes */
type FlatIssue = {
  key: string
  defectId: number
  reportId: number
  reportDate: string
  description: string
  resolved: boolean
  resolved_at?: string | null
  // component/severity intentionally omitted from UI per request
  notes: Note[]
}

export default function ReportsPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <ReportsInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function ReportsInner() {
  const searchParams = useSearchParams()

  const [trucks, setTrucks] = useState<Truck[]>([])
  const [truckId, setTruckId] = useState<number | null>(null)

  const [issues, setIssues] = useState<FlatIssue[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Which issues have their NOTES visible
  const [openNoteKeys, setOpenNoteKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    const qId = searchParams?.get('truckId')
    if (qId) setTruckId(Number(qId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadTrucks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (truckId) loadAllIssuesForTruck(truckId)
  }, [truckId])

  async function loadTrucks() {
    setError(null)
    try {
      const r = await fetch(`${API}/trucks`, { headers: authHeaders() })
      if (!r.ok) throw new Error(await r.text())
      const list: Truck[] = await r.json()
      setTrucks(list)
      if (!truckId) {
        const prefer = searchParams?.get('truckId')
        if (prefer && list.some(t => t.id === Number(prefer))) {
          setTruckId(Number(prefer))
        } else if (list.length) {
          setTruckId(list[0].id)
        }
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load trucks')
      setTrucks([])
    }
  }

  // Page through a truck’s reports using X-Total-Count/skip/limit, then flatten defects + include report notes
  async function loadAllIssuesForTruck(tid: number) {
    setBusy(true)
    setError(null)
    try {
      const limit = 500
      let skip = 0
      let total = Infinity
      const allReports: Report[] = []

      while (skip < total) {
        const r = await fetch(`${API}/trucks/${tid}/reports?skip=${skip}&limit=${limit}`, {
          headers: authHeaders(),
        })
        if (!r.ok) throw new Error(await r.text())
        const data: Report[] = await r.json()
        const t = Number(r.headers.get('X-Total-Count') || '0')
        total = Number.isFinite(t) && t > 0 ? t : data.length
        allReports.push(...data)
        skip += limit
        if (!Number.isFinite(t) && data.length < limit) break
      }

      const flat: FlatIssue[] = []
      for (const rep of allReports) {
        const notes = Array.isArray(rep.notes) ? rep.notes : []
        const defects = Array.isArray(rep.defects) ? rep.defects : []
        for (const d of defects) {
          flat.push({
            key: `${rep.id}:${d.id}`,
            defectId: d.id,
            reportId: rep.id,
            reportDate: rep.created_at,
            description: d.description || '',
            resolved: !!d.resolved,
            resolved_at: d.resolved_at,
            notes,
          })
        }
      }

      // newest first by report date
      flat.sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime())
      setIssues(flat)
      setOpenNoteKeys(new Set()) // collapse notes on reload
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load issues')
      setIssues([])
      setOpenNoteKeys(new Set())
    } finally {
      setBusy(false)
    }
  }

  // Search over description and notes
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return issues
    return issues.filter(it => {
      const inDesc = (it.description || '').toLowerCase().includes(q)
      const inNotes = it.notes.some(n => (n.text || '').toLowerCase().includes(q))
      return inDesc || inNotes
    })
  }, [issues, query])

  const unresolved = filtered.filter(i => !i.resolved)
  const resolved = filtered.filter(i => i.resolved)

  const selectedTruck = trucks.find(t => t.id === truckId) || null

  function toggleNotes(key: string) {
    setOpenNoteKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ---- Issue (defect) mutations ----
  async function editIssue(defectId: number, patch: Partial<Defect>) {
    await fetchJsonOk(`${API}/defects/${defectId}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(patch),
    })
    if (truckId) await loadAllIssuesForTruck(truckId)
  }

  async function deleteIssue(defectId: number) {
    if (!confirm('Delete this issue?')) return
    const r = await fetch(`${API}/defects/${defectId}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) {
      alert(await r.text().catch(() => 'Delete failed'))
      return
    }
    if (truckId) await loadAllIssuesForTruck(truckId)
  }

  // ---- Note mutations (adjust endpoints if your API differs) ----
  async function editNote(noteId: number, patch: Partial<Pick<Note, 'text'>>) {
    await fetchJsonOk(`${API}/notes/${noteId}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(patch),
    })
    if (truckId) await loadAllIssuesForTruck(truckId)
  }

  async function deleteNote(noteId: number) {
    if (!confirm('Delete this note?')) return
    const r = await fetch(`${API}/notes/${noteId}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) {
      alert(await r.text().catch(() => 'Delete failed'))
      return
    }
    if (truckId) await loadAllIssuesForTruck(truckId)
  }

  return (
    <main className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Reports</h1>
        <div className="flex items-center gap-2">
          <ExportAllIssuesButton />
          <ExportTruckIssuesButton truckId={truckId} truckNumber={selectedTruck?.number ?? null} />
        </div>
      </div>

      {/* Controls (Truck + Search) */}
      <div className="border rounded-xl p-3 grid md:grid-cols-3 gap-2 items-end">
        <label className="grid gap-1 text-xs md:col-span-1">
          <span className="text-gray-600">Truck</span>
          <select
            className="border p-1.5 rounded-lg text-sm"
            value={truckId ?? ''}
            onChange={(e) => setTruckId(Number(e.target.value) || null)}
          >
            {trucks.map(t => (
              <option key={t.id} value={t.id}>
                {t.number} {t.active ? '' : '(Inactive)'}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs md:col-span-2">
          <span className="text-gray-600">Search</span>
          <input
            className="border p-1.5 rounded-lg text-sm"
            placeholder="Search issues and notes (e.g., 'brake', 'leak', 'marker')"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
        <span>Total issues: <b>{filtered.length}</b></span>
        <span className="opacity-60">•</span>
        <span>Unresolved: <b>{unresolved.length}</b></span>
        <span className="opacity-60">•</span>
        <span>Resolved: <b>{resolved.length}</b></span>
        {busy && <span className="opacity-60">• Loading…</span>}
      </div>

      {/* Issues lists */}
      <div className="grid lg:grid-cols-2 gap-4">
        <IssuesList
          title="Unresolved Issues"
          rows={unresolved}
          openNoteKeys={openNoteKeys}
          onToggleNotes={toggleNotes}
          onEditIssue={editIssue}
          onDeleteIssue={deleteIssue}
          onEditNote={editNote}
          onDeleteNote={deleteNote}
        />
        <IssuesList
          title="Resolved Issues"
          rows={resolved}
          openNoteKeys={openNoteKeys}
          onToggleNotes={toggleNotes}
          onEditIssue={editIssue}
          onDeleteIssue={deleteIssue}
          onEditNote={editNote}
          onDeleteNote={deleteNote}
        />
      </div>
    </main>
  )
}

/* ---------- helpers ---------- */

async function fetchJsonOk(url: string, init?: RequestInit) {
  const r = await fetch(url, init)
  if (!r.ok) {
    const msg = await r.text().catch(() => 'Request failed')
    throw new Error(msg)
  }
  return r
}

/* ---------- issue list + row UI ---------- */

function IssuesList({
  title,
  rows,
  openNoteKeys,
  onToggleNotes,
  onEditIssue,
  onDeleteIssue,
  onEditNote,
  onDeleteNote,
}: {
  title: string
  rows: FlatIssue[]
  openNoteKeys: Set<string>
  onToggleNotes: (k: string) => void
  onEditIssue: (defectId: number, patch: Partial<Defect>) => Promise<void>
  onDeleteIssue: (defectId: number) => Promise<void>
  onEditNote: (noteId: number, patch: Partial<Pick<Note, 'text'>>) => Promise<void>
  onDeleteNote: (noteId: number) => Promise<void>
}) {
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="px-3 py-2 font-semibold border-b text-sm">{title}</div>
      {rows.length === 0 ? (
        <div className="p-3 text-xs text-gray-500">No issues.</div>
      ) : (
        <div className="divide-y">
          {rows.map(i => (
            <IssueRow
              key={i.key}
              issue={i}
              notesOpen={openNoteKeys.has(i.key)}
              onToggleNotes={() => onToggleNotes(i.key)}
              onEditIssue={onEditIssue}
              onDeleteIssue={onDeleteIssue}
              onEditNote={onEditNote}
              onDeleteNote={onDeleteNote}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function IssueRow({
  issue,
  notesOpen,
  onToggleNotes,
  onEditIssue,
  onDeleteIssue,
  onEditNote,
  onDeleteNote,
}: {
  issue: FlatIssue
  notesOpen: boolean
  onToggleNotes: () => void
  onEditIssue: (defectId: number, patch: Partial<Defect>) => Promise<void>
  onDeleteIssue: (defectId: number) => Promise<void>
  onEditNote: (noteId: number, patch: Partial<Pick<Note, 'text'>>) => Promise<void>
  onDeleteNote: (noteId: number) => Promise<void>
}) {
  const [editingIssue, setEditingIssue] = useState(false)
  const [issueText, setIssueText] = useState(issue.description)
  const [savingIssue, setSavingIssue] = useState(false)
  const [toggling, setToggling] = useState(false)

  // per-note edit states
  const [noteEdits, setNoteEdits] = useState<Record<number, string>>({})
  const [noteEditing, setNoteEditing] = useState<Record<number, boolean>>({})
  const [noteSaving, setNoteSaving] = useState<Record<number, boolean>>({})

  useEffect(() => {
    if (!editingIssue) setIssueText(issue.description)
  }, [issue.description, editingIssue])

  async function saveIssue() {
    try {
      setSavingIssue(true)
      await onEditIssue(issue.defectId, { description: issueText })
      setEditingIssue(false)
    } catch (e: any) {
      alert(e?.message ?? 'Failed to save issue')
    } finally {
      setSavingIssue(false)
    }
  }

  async function toggleResolved() {
    try {
      setToggling(true)
      await onEditIssue(issue.defectId, { resolved: !issue.resolved })
    } catch (e: any) {
      alert(e?.message ?? 'Failed to update status')
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="p-2 text-sm">
      {/* Single compact row */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span>Date: {formatDateMDY(issue.reportDate)}</span>
          {issue.resolved && issue.resolved_at ? (
            <>
              <span className="opacity-60">•</span>
              <span>Resolved: {formatDateMDY(issue.resolved_at)}</span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <input
            className={`border rounded-md px-2 py-1 flex-1 text-sm ${!editingIssue ? 'bg-gray-100 text-gray-800 cursor-not-allowed' : ''}`}
            value={issueText}
            onChange={(e) => setIssueText(e.target.value)}
            readOnly={!editingIssue}
          />
          {!editingIssue ? (
            <>
              <button
                className="px-1.5 py-0.5 text-[11px] border rounded-md"
                onClick={() => setEditingIssue(true)}
                title="Edit issue"
              >
                Edit
              </button>
              <button
                className="px-1.5 py-0.5 text-[11px] border rounded-md"
                onClick={toggleResolved}
                disabled={toggling}
                title={issue.resolved ? 'Reopen issue' : 'Resolve issue'}
              >
                {toggling ? '…' : issue.resolved ? 'Reopen' : 'Resolve'}
              </button>
              <button
                className="px-1.5 py-0.5 text-[11px] border rounded-md border-red-600 text-red-600"
                onClick={() => onDeleteIssue(issue.defectId)}
                title="Delete issue"
              >
                Delete
              </button>
              <button
                className="px-1.5 py-0.5 text-[11px] border rounded-md"
                onClick={onToggleNotes}
                title={notesOpen ? 'Hide notes' : 'Show notes'}
              >
                {notesOpen ? 'Hide notes' : 'Show notes'}
              </button>
            </>
          ) : (
            <>
              <button
                className="px-1.5 py-0.5 text-[11px] border rounded-md"
                onClick={() => { setEditingIssue(false); setIssueText(issue.description) }}
                disabled={savingIssue}
                title="Cancel"
              >
                Cancel
              </button>
              <button
                className="px-1.5 py-0.5 text-[11px] border rounded-md bg-black text-white disabled:opacity-50"
                onClick={saveIssue}
                disabled={savingIssue}
                title="Save"
              >
                {savingIssue ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Notes (only when toggled) */}
      {notesOpen && (
        <div className="mt-2 space-y-2">
          {issue.notes.length === 0 ? (
            <div className="text-xs text-gray-500">No notes.</div>
          ) : (
            issue.notes.map(n => {
              const isEditing = !!noteEditing[n.id]
              const val = isEditing ? (noteEdits[n.id] ?? n.text) : n.text
              return (
                <div key={n.id} className="border rounded-md p-2">
                  <div className="text-[11px] text-gray-600 mb-1">
                    {formatDateMDY(n.created_at)}{n.author?.name ? ` · ${n.author.name}` : ''}
                  </div>
                  <div className="flex items-start gap-2">
                    <textarea
                      className={`border rounded-md p-1.5 text-sm flex-1 min-h-[36px] ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      value={val}
                      readOnly={!isEditing}
                      onChange={(e) => setNoteEdits(prev => ({ ...prev, [n.id]: e.target.value }))}
                    />
                    {!isEditing ? (
                      <div className="flex flex-col gap-1">
                        <button
                          className="px-1.5 py-0.5 text-[11px] border rounded-md"
                          onClick={() => {
                            setNoteEditing(prev => ({ ...prev, [n.id]: true }))
                            setNoteEdits(prev => ({ ...prev, [n.id]: n.text }))
                          }}
                          title="Edit note"
                        >
                          Edit
                        </button>
                        <button
                          className="px-1.5 py-0.5 text-[11px] border rounded-md border-red-600 text-red-600"
                          onClick={() => onDeleteNote(n.id)}
                          title="Delete note"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <button
                          className="px-1.5 py-0.5 text-[11px] border rounded-md"
                          disabled={!!noteSaving[n.id]}
                          onClick={() => {
                            setNoteEditing(prev => ({ ...prev, [n.id]: false }))
                            setNoteEdits(prev => {
                              const { [n.id]: _, ...rest } = prev
                              return rest
                            })
                          }}
                          title="Cancel"
                        >
                          Cancel
                        </button>
                        <button
                          className="px-1.5 py-0.5 text-[11px] border rounded-md bg-black text-white disabled:opacity-50"
                          disabled={!!noteSaving[n.id]}
                          onClick={async () => {
                            try {
                              setNoteSaving(prev => ({ ...prev, [n.id]: true }))
                              await onEditNote(n.id, { text: noteEdits[n.id] ?? n.text })
                              setNoteEditing(prev => ({ ...prev, [n.id]: false }))
                              setNoteEdits(prev => {
                                const { [n.id]: _, ...rest } = prev
                                return rest
                              })
                            } catch (e: any) {
                              alert(e?.message ?? 'Failed to save note')
                            } finally {
                              setNoteSaving(prev => ({ ...prev, [n.id]: false }))
                            }
                          }}
                          title="Save"
                        >
                          {noteSaving[n.id] ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

/* =======================
   Export (All Trucks)
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
      lines.push([ '', '', '', '' ].join(','))
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
      const trucksRes = await fetch(`${API}/trucks`, { headers: authHeaders() })
      if (!trucksRes.ok) throw new Error(await trucksRes.text())
      const trucks: { id:number; number:string }[] = await trucksRes.json()

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

      const headers = ['Truck', 'Date of Issue', 'Issue', 'Date Resolved / Status']
      const csv = toCsv(allRows, headers)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const ts = formatDateMDY(new Date())
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
      className="px-2.5 py-1 text-[11px] border rounded-md disabled:opacity-50"
      title="Export all issues for all trucks"
    >
      {busy ? 'Exporting…' : 'Export All Issues'}
    </button>
  )
}

/* =======================
   Export (Selected Truck) – TS-safe
   ======================= */

function ExportTruckIssuesButton({
  truckId,
  truckNumber,
}: {
  truckId: number | null
  truckNumber?: string | null
}) {
  const [busy, setBusy] = useState(false)

  if (truckId == null) {
    return (
      <button
        className="px-2.5 py-1 text-[11px] border rounded-md opacity-50 cursor-not-allowed"
        disabled
        title="Select a truck to export"
      >
        Export This Truck
      </button>
    )
  }

  const id: number = truckId // narrowed by guard

  async function fetchWithHeaders(url: string) {
    const r = await fetch(url, { headers: authHeaders() })
    if (!r.ok) throw new Error(await r.text().catch(() => 'Request failed'))
    const data = await r.json()
    const total = Number(r.headers.get('X-Total-Count') || '0')
    return { data, total }
  }

  async function fetchAllReportsForTruck(idNum: number) {
    const all: any[] = []
    const limit = 500
    let skip = 0
    let total = Infinity

    while (skip < total) {
      const { data, total: t } = await fetchWithHeaders(
        `${API}/trucks/${idNum}/reports?skip=${skip}&limit=${limit}`
      )
      total = isFinite(t) && t > 0 ? t : data.length
      all.push(...data)
      skip += limit
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
      lines.push([ '', '', '', '' ].join(','))
    } else {
      for (const row of rows) {
        lines.push(headers.map(h => escapeCell(row[h])).join(','))
      }
    }
    return lines.join('\n')
  }

  async function exportTruckCsv(idNum: number) {
    try {
      setBusy(true)
      const reports = await fetchAllReportsForTruck(idNum)
      const rows: Record<string, any>[] = []
      for (const r of reports) {
        const createdAt = r?.created_at
        const defects = Array.isArray(r?.defects) ? r.defects : []
        for (const d of defects) {
          const issueDate = createdAt ? formatDateMDY(createdAt) : ''
          const issueText = d?.description ?? ''
          const resolvedDate = d?.resolved
            ? (d?.resolved_at ? formatDateMDY(d.resolved_at) : '')
            : 'Unresolved'
          rows.push({
            'Truck': truckNumber ?? idNum,
            'Date of Issue': issueDate,
            'Issue': issueText,
            'Date Resolved / Status': resolvedDate,
          })
        }
      }
      const headers = ['Truck', 'Date of Issue', 'Issue', 'Date Resolved / Status']
      const csv = toCsv(rows, headers)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const ts = formatDateMDY(new Date())
      const safeNo = (truckNumber || `truck-${idNum}`).replace(/[^\w-]+/g, '_')
      a.download = `${safeNo}-issues-${ts}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e: any) {
      alert(e?.message ?? 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={() => exportTruckCsv(id)}
      disabled={busy}
      className="px-2.5 py-1 text-[11px] border rounded-md disabled:opacity-50"
      title="Export issues for the selected truck"
    >
      {busy ? 'Exporting…' : 'Export This Truck'}
    </button>
  )
}
