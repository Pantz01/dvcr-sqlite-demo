const API = process.env.NEXT_PUBLIC_API!;
'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'

export default function ReportDetail() {
  const { id } = useParams() as { id: string }
  const [report, setReport] = useState<any>(null)
  const [note, setNote] = useState('')
  const uid = typeof window !== 'undefined' ? localStorage.getItem('x-user-id') : null
  const svgRef = useRef<SVGSVGElement>(null)

  function reload() {
    fetch(`${API}/reports/${id}`).then(r=>r.json()).then(setReport)
  }
  useEffect(reload, [id])

  async function addNote(e: any) {
    e.preventDefault()
    await fetch(`${API}/reports/${id}/notes`, { method:'POST', headers:{'Content-Type':'application/json','x-user-id':uid||''}, body: JSON.stringify({ text: note }) })
    setNote(''); reload()
  }

  async function addDefectFromClick(e: any) {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const component = prompt('Component (e.g., tire, lights, brakes)') || 'unknown'
    const description = prompt('Describe the issue') || ''
    await fetch(`${API}/reports/${id}/defects`, { method:'POST', headers:{'Content-Type':'application/json','x-user-id':uid||''}, body: JSON.stringify({ component, description, severity:'minor', x, y }) })
    reload()
  }

  async function uploadPhotos(defectId: number, files: FileList) {
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('files', f)
    await fetch(`${API}/defects/${defectId}/photos`, { method:'POST', headers:{'x-user-id':uid||''}, body: fd })
    reload()
  }

  async function toggleResolved(defectId: number, resolved: boolean) {
    await fetch(`${API}/defects/${defectId}`, { method:'PATCH', headers:{'Content-Type':'application/json','x-user-id':uid||''}, body: JSON.stringify({ resolved }) })
    reload()
  }

  if (!report) return <main className="p-6">Loading...</main>

  return (
    <main className="p-6 space-y-6">
      <a href={`/trucks/${report.truck.id}`} className="text-sm">← Back to truck</a>
      <h1 className="text-2xl font-bold">Report #{report.id} — Truck #{report.truck.number}</h1>

      <section className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="font-semibold mb-2">Tap/click to drop a defect pin</h2>
          <div className="border rounded-2xl overflow-hidden">
            <svg ref={svgRef} onClick={addDefectFromClick} viewBox="0 0 800 300" className="w-full h-auto cursor-crosshair">
              <rect x="120" y="120" width="620" height="120" rx="16" ry="16" fill="#e5e7eb" />
              <rect x="40" y="150" width="120" height="90" rx="12" ry="12" fill="#d1d5db" />
              <circle cx="150" cy="260" r="20" fill="#9ca3af" />
              <circle cx="250" cy="260" r="20" fill="#9ca3af" />
              <circle cx="600" cy="260" r="20" fill="#9ca3af" />
              <circle cx="680" cy="260" r="20" fill="#9ca3af" />

              {report.defects?.map((d:any) => (
                (d.x!=null && d.y!=null) && (
                  <g key={d.id} transform={`translate(${d.x*800}, ${d.y*300})`}>
                    <circle r="8" fill={d.resolved ? '#10b981' : '#ef4444'} />
                    <title>{`${d.component}: ${d.description||''}`}</title>
                  </g>
                )
              ))}
            </svg>
          </div>
          <p className="text-xs text-gray-500 mt-2">Pins turn green when resolved by a mechanic/manager.</p>
        </div>

        <div>
          <h2 className="font-semibold mb-2">Defects</h2>
          <ul className="space-y-3">
            {report.defects?.map((d:any) => (
              <li key={d.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{d.component} <span className="text-xs text-gray-500">({d.severity})</span></div>
                  <button className="text-sm border rounded-lg px-2 py-1" onClick={()=>toggleResolved(d.id, !d.resolved)}>
                    {d.resolved ? 'Mark Unresolved' : 'Mark Resolved'}
                  </button>
                </div>
                <div className="text-sm text-gray-700 mt-1">{d.description}</div>
                <div className="mt-2">
                  <label className="text-sm block mb-1">Add photos</label>
                  <input type="file" multiple onChange={(e)=> e.target.files && uploadPhotos(d.id, e.target.files)} />
                </div>
                {d.photos?.length ? (
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {d.photos.map((p:any)=> (
                      <a key={p.id} href={p.path} target="_blank" className="block border rounded-lg overflow-hidden">
                        <img src={p.path} alt={p.caption||''} className="w-full h-24 object-cover" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Notes</h2>
        <form onSubmit={addNote} className="flex gap-2">
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Leave a note" className="border p-2 rounded-xl flex-1" />
          <button className="border rounded-xl px-3">Post</button>
        </form>
        <ul className="space-y-2">
          {report.notes?.map((n:any)=> (
            <li key={n.id} className="border rounded-xl p-2">
              <div className="text-sm text-gray-600">{n.author.name} • {new Date(n.created_at).toLocaleString()}</div>
              <div>{n.text}</div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
