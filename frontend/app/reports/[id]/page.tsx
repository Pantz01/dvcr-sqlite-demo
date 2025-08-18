'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import RequireAuth from '@/components/RequireAuth'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

export default function ReportDetail() {
  return (
    <RequireAuth>
      <ReportDetailInner />
    </RequireAuth>
  )
}

function ReportDetailInner() {
  const { id } = useParams() as { id: string }
  const [report, setReport] = useState<any>(null)
  const [note, setNote] = useState('')

  function reload() {
    fetch(`${API}/reports/${id}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(setReport)
      .catch(async (r) => alert(typeof r?.text === 'function' ? await r.text() : 'Failed to load report'))
  }

  useEffect(reload, [id])

  async function addNote(e: React.FormEvent) {
    e.preventDefault()
    const r = await fetch(`${API}/reports/${id}/notes`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ text: note })
    })
    if (!r.ok) { alert(await r.text()); return }
    setNote('')
    reload()
  }

  async function toggleResolved(defectId: number, resolved: boolean) {
    const r = await fetch(`${API}/defects/${defectId}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ resolved })
    })
    if (!r.ok) { alert(await r.text()); return }
    reload()
  }

  async function uploadPhotos(defectId: number, files: FileList) {
    const fd = new FormData()
    Array.from(files).forEach(f => fd.append('files', f))
    const r = await fetch(`${API}/defects/${defectId}/photos`, {
      method: 'POST',
      headers: authHeaders(), // let browser set multipart boundary
      body: fd
    })
    if (!r.ok) { alert(await r.text()); return }
    reload()
  }

  if (!report) return <main className="p-6">Loading…</main>

  return (
    <main className="p-6 space-y-6">
      <a href={`/trucks/${report.truck.id}`} className="text-sm underline">&larr; Back to truck</a>

      {/* NEW: Header formatting */}
      <h1 className="text-2xl font-bold">Issue report for:</h1>
      <div className="text-gray-800">
        <span className="font-semibold">Truck #{report.truck.number}</span>
        <span className="mx-2">•</span>
        <span>{new Date(report.created_at).toLocaleString()}</span>
      </div>

      {/* REMOVED: Summary block */}

      {/* Defects list — no component/severity line */}
      <section className="space-y-3">
        <h2 className="font-semibold">Issues</h2>
        {report.defects?.length ? (
          <ul className="space-y-3">
            {report.defects.map((d: any) => (
              <li key={d.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-medium">
                      {d.description || '(no description)'}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {d.resolved ? 'Resolved' : 'Unresolved'}
                    </div>
                  </div>
                  <button
                    className="text-sm border rounded-lg px-2 py-1"
                    onClick={() => toggleResolved(d.id, !d.resolved)}
                  >
                    {d.resolved ? 'Mark Unresolved' : 'Mark Resolved'}
                  </button>
                </div>

                {d.photos?.length ? (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {d.photos.map((p: any) => (
                      <a
                        key={p.id}
                        href={p.path}
                        target="_blank"
                        rel="noreferrer"
                        className="block border rounded-lg overflow-hidden"
                      >
                        <img
                          src={p.path}
                          alt={p.caption || 'defect photo'}
                          className="w-full h-24 object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}

                {/* Keep ability to add photos to an issue */}
                <div className="mt-3">
                  <label className="text-sm block mb-1">Add photos</label>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => e.target.files && uploadPhotos(d.id, e.target.files)}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-gray-500">No issues on this report.</div>
        )}
      </section>

      {/* Notes */}
      <section className="space-y-2">
        <h2 className="font-semibold">Notes</h2>
        <form onSubmit={addNote} className="flex gap-2">
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Leave a note"
            className="border p-2 rounded-xl flex-1"
          />
          <button className="border rounded-xl px-3">Post</button>
        </form>
        <ul className="space-y-2">
          {report.notes?.map((n: any) => (
            <li key={n.id} className="border rounded-xl p-2">
              <div className="text-sm text-gray-600">
                {n.author?.name ?? 'User'} • {new Date(n.created_at).toLocaleString()}
              </div>
              <div>{n.text}</div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
