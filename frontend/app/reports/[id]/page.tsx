'use client'
const API = process.env.NEXT_PUBLIC_API!;

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { authHeaders } from '@/lib/api'

export default function ReportDetail() {
  const { id } = useParams() as { id: string }
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    setError(null)
    const r = await fetch(`${API}/reports/${id}`, { headers: authHeaders() })
    if (!r.ok) {
      setError(await r.text().catch(()=> 'Failed to load report'))
      setLoading(false)
      return
    }
    setReport(await r.json())
    setLoading(false)
  }

  useEffect(() => { reload() }, [id])

  if (loading) return <main className="p-6">Loading...</main>
  if (error) return <main className="p-6 text-red-600">{error}</main>
  if (!report) return <main className="p-6">Not found.</main>

  return (
    <main className="p-6 space-y-6">
      {/* Back links */}
      <div className="flex items-center justify-between">
        <Link href={`/trucks/${report.truck?.id ?? ''}`} className="text-sm underline">
          &larr; Back to Truck #{report.truck?.number}
        </Link>
        <Link href="/trucks" className="text-sm underline">Fleet</Link>
      </div>

      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Report #{report.id}</h1>
          <div className="text-sm text-gray-600">
            {String(report.type || '').toUpperCase()} · {new Date(report.created_at).toLocaleString()} · Truck #{report.truck?.number}
          </div>
        </div>
        <span
          className={`px-2 py-1 text-xs rounded-full border ${
            report.status === 'OPEN'
              ? 'bg-yellow-50 border-yellow-300 text-yellow-800'
              : 'bg-green-50 border-green-300 text-green-800'
          }`}
        >
          {report.status}
        </span>
      </header>

      {/* Meta */}
      <section className="grid sm:grid-cols-3 gap-3">
        <div className="border rounded-2xl p-3">
          <div className="text-xs text-gray-500">Odometer</div>
          <div className="font-semibold">{report.odometer ?? '—'}</div>
        </div>
        <div className="border rounded-2xl p-3">
          <div className="text-xs text-gray-500">Driver</div>
          <div className="font-semibold">{report.driver?.name ?? '—'}</div>
        </div>
        <div className="border rounded-2xl p-3">
          <div className="text-xs text-gray-500">Summary</div>
          <div className="font-semibold">{report.summary || '—'}</div>
        </div>
      </section>

      {/* Issues (read-only) */}
      <section className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b">Issues</div>
        {(!report.defects || report.defects.length === 0) ? (
          <div className="p-3 text-sm text-gray-500">No issues were recorded on this report.</div>
        ) : (
          <div className="divide-y">
            {report.defects.map((d: any) => (
              <div key={d.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{d.description || '(no description)'}</div>
                    <div className="text-xs text-gray-500">
                      {(d.component || 'general')} · {(d.severity || 'minor')}
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border ${
                      d.resolved ? 'bg-green-50 border-green-300 text-green-800' : 'bg-red-50 border-red-300 text-red-800'
                    }`}
                  >
                    {d.resolved ? 'Resolved' : 'Open'}
                  </span>
                </div>

                {d.photos && d.photos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {d.photos.map((p: any) => (
                      <a key={p.id} href={p.path} target="_blank" rel="noreferrer" className="inline-block">
                        <img
                          src={p.path}
                          alt={p.caption || 'defect photo'}
                          className="h-20 w-20 object-cover rounded-md border"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Notes (read-only if provided by backend) */}
      {report.notes && report.notes.length > 0 && (
        <section className="border rounded-2xl overflow-hidden">
          <div className="p-3 font-semibold border-b">Notes</div>
          <div className="divide-y">
            {report.notes.map((n: any) => (
              <div key={n.id} className="p-3 text-sm">
                <div className="text-gray-600">
                  {new Date(n.created_at).toLocaleString()} — {n.author?.name ?? 'Unknown'}
                </div>
                <div>{n.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
