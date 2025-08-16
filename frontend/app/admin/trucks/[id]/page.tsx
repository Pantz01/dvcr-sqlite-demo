'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

type Truck = {
  id: number
  number: string
  vin?: string | null
  active: boolean
  odometer: number
}

type Photo = {
  id: number
  path: string
  caption?: string | null
}

type Defect = {
  id: number
  component: string
  severity: string
  description?: string | null
  x?: number | null
  y?: number | null
  resolved: boolean
  resolved_by_id?: number | null
  resolved_at?: string | null
  photos: Photo[]
}

type Report = {
  id: number
  created_at: string
  odometer?: number | null
  status: string
  summary?: string | null
  type: 'pre' | 'post'
  driver: { id: number; name: string; email: string; role: string }
  truck: Truck
  defects?: Defect[]
  notes?: any[]
}

export default function ManageReportsPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <ManageReportsInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function ManageReportsInner() {
  const params = useParams() as { id: string }
  const truckId = Number(params.id)

  const [truck, setTruck] = useState<Truck | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [filter, setFilter] = useState<'all' | 'pre' | 'post'>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // create form
  const [newType, setNewType] = useState<'pre' | 'post'>('pre')
  const [newOdo, setNewOdo] = useState<number>(0)
  const [newSummary, setNewSummary] = useState('')

  // which report row is expanded
  const [openId, setOpenId] = useState<number | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  useEffect(() => {
    loadTruck()
    loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckId])

  async function loadTruck() {
    const r = await fetch(`${API}/trucks/${truckId}`, { headers: authHeaders() })
    if (r.ok) setTruck(await r.json())
  }

  async function loadReports() {
    setLoading(true)
    const r = await fetch(`${API}/trucks/${truckId}/reports`, { headers: authHeaders() })
    setLoading(false)
    if (!r.ok) { alert(await r.text()); return }
    setReports(await r.json())
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return reports
    return reports.filter(r => r.type === filter)
  }, [reports, filter])

  async function createReport() {
    if (!newOdo || newOdo < 0) {
      if (!confirm('Odometer is 0 — continue?')) return
    }
    setBusy(true)
    const r = await fetch(`${API}/trucks/${truckId}/reports`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ type: newType, odometer: newOdo, summary: newSummary }),
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
    setNewSummary('')
    setNewOdo(0)
    await loadReports()
    await loadTruck()
  }

  async function saveReport(id: number, patch: Partial<Report>) {
    const r = await fetch(`${API}/reports/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({
        status: patch.status,
        summary: patch.summary,
        odometer: patch.odometer,
      }),
    })
    if (!r.ok) { alert(await r.text()); return }
    const updated = await r.json()
    setReports(prev => prev.map(x => x.id === id ? updated : x))
    if (patch.odometer !== undefined) {
      loadTruck()
    }
  }

  async function deleteReport(id: number) {
    if (!confirm('Delete this report? This will also remove its defects, notes, and photos.')) return
    const r = await fetch(`${API}/reports/${id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    setReports(prev => prev.filter(x => x.id !== id))
    if (openId === id) setOpenId(null)
  }

  async function toggleOpen(id: number) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    setLoadingReport(true)
    const r = await fetch(`${API}/reports/${id}`, { headers: authHeaders() })
    setLoadingReport(false)
    if (!r.ok) { alert(await r.text()); return }
    const full = await r.json() as Report
    setReports(prev => prev.map(x => x.id === id ? full : x))
  }

  // defect actions
  async function addDefect(reportId: number, d: { component: string; severity: string; description?: string }) {
    const r = await fetch(`${API}/reports/${reportId}/defects`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(d),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadReport(reportId)
  }

  async function patchDefect(reportId: number, defectId: number, patch: Partial<Defect>) {
    const r = await fetch(`${API}/defects/${defectId}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({
        description: patch.description,
        resolved: patch.resolved,
      }),
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadReport(reportId)
  }

  async function deleteDefect(reportId: number, defectId: number) {
    if (!confirm('Delete this defect (and its photos)?')) return
    const r = await fetch(`${API}/defects/${defectId}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    await reloadReport(reportId)
  }

  async function deletePhoto(reportId: number, photoId: number) {
    if (!confirm('Delete this photo?')) return
    const r = await fetch(`${API}/photos/${photoId}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    await reloadReport(reportId)
  }

  async function uploadPhotos(reportId: number, defectId: number, files: FileList, caption?: string) {
    if (!files || files.length === 0) return
    const fd = new FormData()
    Array.from(files).forEach(f => fd.append('files', f))
    if (caption) fd.append('captions', caption)
    const r = await fetch(`${API}/defects/${defectId}/photos`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    })
    if (!r.ok) { alert(await r.text()); return }
    await reloadReport(reportId)
  }

  async function reloadReport(reportId: number) {
    const rr = await fetch(`${API}/reports/${reportId}`, { headers: authHeaders() })
    if (rr.ok) {
      const full = await rr.json()
      setReports(prev => prev.map(x => x.id === reportId ? full : x))
    }
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Manage Reports {truck ? `· ${truck.number}` : ''}</h1>
        <Link href="/admin/trucks" className="underline text-sm">← Back to Trucks</Link>
      </div>

      {/* Create new report */}
      <div className="border rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Add Report</div>
        <div className="grid sm:grid-cols-5 gap-2">
          <select
            className="border p-2 rounded-xl"
            value={newType}
            onChange={(e) => setNewType(e.target.value as 'pre' | 'post')}
          >
            <option value="pre">pre</option>
            <option value="post">post</option>
          </select>

          <input
            type="number"
            className="border p-2 rounded-xl"
            placeholder="Odometer"
            value={newOdo}
            onChange={(e) => setNewOdo(parseInt(e.target.value || '0', 10))}
          />

          <input
            className="border p-2 rounded-xl sm:col-span-2"
            placeholder="Summary (optional)"
            value={newSummary}
            onChange={(e) => setNewSummary(e.target.value)}
          />

          <button
            className="border rounded-xl p-2"
            disabled={busy}
            onClick={createReport}
          >
            {busy ? 'Saving…' : 'Add'}
          </button>
        </div>
        <p className="text-xs text-gray-600">
          Pre/Post trip reports update the truck’s odometer if you enter a higher reading.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">Filter:</span>
        <button
          className={`text-sm px-2 py-1 rounded ${filter==='all' ? 'bg-gray-200' : 'border'}`}
          onClick={() => setFilter('all')}
        >All</button>
        <button
          className={`text-sm px-2 py-1 rounded ${filter==='pre' ? 'bg-gray-200' : 'border'}`}
          onClick={() => setFilter('pre')}
        >Pre</button>
        <button
          className={`text-sm px-2 py-1 rounded ${filter==='post' ? 'bg-gray-200' : 'border'}`}
          onClick={() => setFilter('post')}
        >Post</button>
      </div>

      {/* Reports list */}
      <div className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b">Reports</div>
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No reports.</div>
        ) : (
          <div className="divide-y">
            {filtered.map(r => (
              <ReportRow
                key={r.id}
                r={r}
                isOpen={openId === r.id}
                loadingDetails={loadingReport && openId === r.id}
                onToggle={() => toggleOpen(r.id)}
                onSave={saveReport}
                onDelete={deleteReport}
                onAddDefect={addDefect}
                onPatchDefect={patchDefect}
                onUploadPhotos={uploadPhotos}
                onDeleteDefect={deleteDefect}
                onDeletePhoto={deletePhoto}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function ReportRow({
  r,
  isOpen,
  loadingDetails,
  onToggle,
  onSave,
  onDelete,
  onAddDefect,
  onPatchDefect,
  onUploadPhotos,
  onDeleteDefect,
  onDeletePhoto,
}: {
  r: Report
  isOpen: boolean
  loadingDetails: boolean
  onToggle: () => void
  onSave: (id: number, patch: Partial<Report>) => void
  onDelete: (id: number) => void
  onAddDefect: (reportId: number, d: { component: string; severity: string; description?: string }) => void
  onPatchDefect: (reportId: number, defectId: number, patch: Partial<Defect>) => void
  onUploadPhotos: (reportId: number, defectId: number, files: FileList, caption?: string) => void
  onDeleteDefect: (reportId: number, defectId: number) => void
  onDeletePhoto: (reportId: number, photoId: number) => void
}) {
  const [status, setStatus] = useState(r.status)
  const [summary, setSummary] = useState(r.summary || '')
  const [odo, setOdo] = useState<number>(r.odometer ?? 0)
  const [saving, setSaving] = useState(false)

  // new defect form
  const [comp, setComp] = useState('')
  const [sev, setSev] = useState<'minor' | 'major' | 'critical'>('minor')
  const [desc, setDesc] = useState('')

  async function save() {
    setSaving(true)
    await onSave(r.id, { status, summary, odometer: odo })
    setSaving(false)
  }

  async function addDefectClick() {
    if (!comp.trim()) { alert('Component is required'); return }
    await onAddDefect(r.id, { component: comp.trim(), severity: sev, description: desc.trim() || undefined })
    setComp(''); setSev('minor'); setDesc('')
  }

  return (
    <div className="p-3">
      <div className="grid md:grid-cols-6 gap-3 items-center">
        <div className="text-xs uppercase">{r.type}</div>
        <div className="text-sm">{new Date(r.created_at).toLocaleString()}</div>

        <div>
          <label className="text-xs text-gray-600">Status</label>
          <select
            className="border p-2 rounded-xl w-full"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="OPEN">OPEN</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-600">Odometer</label>
          <input
            type="number"
            className="border p-2 rounded-xl w-full"
            value={odo}
            onChange={(e) => setOdo(parseInt(e.target.value || '0', 10))}
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-xs text-gray-600">Summary</label>
          <input
            className="border p-2 rounded-xl w-full"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>

        <div className="md:col-span-6 flex items-center gap-3 pt-1">
          <button
            className="border rounded-xl px-3 py-1"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          <button
            className="text-red-600 underline text-sm"
            onClick={() => onDelete(r.id)}
          >
            Delete
          </button>

          <button
            className="underline text-sm ml-auto"
            onClick={onToggle}
          >
            {isOpen ? 'Hide details' : 'Show details'}
          </button>
        </div>
      </div>

      {/* Expanded details: defects + photos */}
      {isOpen && (
        <div className="mt-4 rounded-xl border p-3">
          {loadingDetails ? (
            <div className="text-sm text-gray-500">Loading details…</div>
          ) : (
            <>
              <div className="font-semibold mb-2">Defects</div>

              {/* Existing defects */}
              <div className="space-y-3">
                {(r.defects ?? []).map(d => (
                  <DefectRow
                    key={d.id}
                    rId={r.id}
                    d={d}
                    onPatch={(patch) => onPatchDefect(r.id, d.id, patch)}
                    onUpload={(files, caption) => onUploadPhotos(r.id, d.id, files, caption)}
                    onDelete={() => onDeleteDefect(r.id, d.id)}
                    onDeletePhoto={(photoId) => onDeletePhoto(r.id, photoId)}
                  />
                ))}
                {(r.defects ?? []).length === 0 && (
                  <div className="text-sm text-gray-500">No defects for this report.</div>
                )}
              </div>

              {/* Add defect */}
              <div className="mt-4 border rounded-xl p-3 space-y-2">
                <div className="font-medium">Add Defect</div>
                <div className="grid sm:grid-cols-5 gap-2">
                  <input
                    className="border p-2 rounded-xl"
                    placeholder="Component (e.g., Brakes)"
                    value={comp}
                    onChange={(e) => setComp(e.target.value)}
                  />
                  <select
                    className="border p-2 rounded-xl"
                    value={sev}
                    onChange={(e) => setSev(e.target.value as any)}
                  >
                    <option value="minor">minor</option>
                    <option value="major">major</option>
                    <option value="critical">critical</option>
                  </select>
                  <input
                    className="border p-2 rounded-xl sm:col-span-2"
                    placeholder="Description (optional)"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                  />
                  <button className="border rounded-xl p-2" onClick={addDefectClick}>
                    Add defect
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DefectRow({
  rId,
  d,
  onPatch,
  onUpload,
  onDelete,
  onDeletePhoto,
}: {
  rId: number
  d: Defect
  onPatch: (patch: Partial<Defect>) => void
  onUpload: (files: FileList, caption?: string) => void
  onDelete: () => void
  onDeletePhoto: (photoId: number) => void
}) {
  const [desc, setDesc] = useState(d.description ?? '')
  const [resolved, setResolved] = useState(d.resolved)
  const [saving, setSaving] = useState(false)
  const [caption, setCaption] = useState('')

  async function save() {
    setSaving(true)
    await onPatch({ description: desc, resolved })
    setSaving(false)
  }

  return (
    <div className="border rounded-xl p-3">
      <div className="grid md:grid-cols-7 gap-2 items-start">
        <div className="text-sm font-medium md:col-span-2">
          {d.component} <span className="text-xs text-gray-600">({d.severity})</span>
        </div>

        <div className="md:col-span-2">
          <label className="text-xs text-gray-600">Description</label>
          <input
            className="border p-2 rounded-xl w-full"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id={`res-${d.id}`}
            type="checkbox"
            checked={resolved}
            onChange={(e) => setResolved(e.target.checked)}
          />
          <label htmlFor={`res-${d.id}`} className="text-sm">Resolved</label>
        </div>

        <div className="flex items-center gap-2">
          <button className="border rounded-xl px-3 py-1" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="text-red-600 underline text-xs" onClick={onDelete}>
            Delete defect
          </button>
        </div>
      </div>

      {/* Photos */}
      <div className="mt-3">
        <div className="text-sm font-medium mb-1">Photos</div>
        <div className="flex flex-wrap gap-3">
          {(d.photos ?? []).map(p => (
            <div key={p.id} className="flex flex-col items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <a href={p.path} target="_blank" rel="noreferrer" title={p.caption || ''}>
                <img
                  src={p.path}
                  alt={p.caption || 'photo'}
                  className="h-20 w-28 object-cover rounded-lg border"
                />
              </a>
              <button
                className="text-red-600 underline text-[11px]"
                onClick={() => onDeletePhoto(p.id)}
              >
                Delete photo
              </button>
            </div>
          ))}
          {(d.photos ?? []).length === 0 && (
            <div className="text-xs text-gray-500">No photos.</div>
          )}
        </div>

        {/* Upload */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Caption (optional)"
            className="border p-2 rounded-xl"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <label className="cursor-pointer border rounded-xl px-3 py-2">
            Upload photos
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) onUpload(e.target.files, caption)
                setCaption('')
                e.currentTarget.value = ''
              }}
            />
          </label>
        </div>
      </div>
    </div>
  )
}
