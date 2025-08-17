'use client'

import { useEffect, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

type Role = {
  id: number
  name: string
  permissions: string[]
  created_at?: string
}

type PermissionKey =
  | 'trucks.view'
  | 'trucks.edit'
  | 'services.add'
  | 'services.delete'
  | 'reports.view'
  | 'reports.manage'
  | 'alerts.export'
  | 'users.manage'
  | 'roles.manage'

const ALL_PERMISSIONS: { key: PermissionKey; label: string; group: string }[] = [
  { key: 'trucks.view',    label: 'View Trucks',            group: 'Trucks' },
  { key: 'trucks.edit',    label: 'Edit Trucks',            group: 'Trucks' },
  { key: 'services.add',   label: 'Add Service Records',    group: 'PM/Service' },
  { key: 'services.delete',label: 'Delete Service Records', group: 'PM/Service' },
  { key: 'reports.view',   label: 'View Reports',           group: 'Reports' },
  { key: 'reports.manage', label: 'Manage Reports',         group: 'Reports' },
  { key: 'alerts.export',  label: 'Export Alerts (Excel)',  group: 'Reports' },
  { key: 'users.manage',   label: 'Manage Users',           group: 'Admin' },
  { key: 'roles.manage',   label: 'Manage Roles/Perms',     group: 'Admin' },
]
const GROUPS = Array.from(new Set(ALL_PERMISSIONS.map(p => p.group)))

export default function RolesPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['admin']}>
        <main className="p-6 space-y-6">
          <h1 className="text-2xl font-bold">Roles & Permissions</h1>
          <RolesManager />
        </main>
      </RoleGuard>
    </RequireAuth>
  )
}

function RolesManager() {
  const [roles, setRoles] = useState<Role[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // per-role edit buffers
  const [editing, setEditing] = useState<Record<number, boolean>>({})
  const [buffer, setBuffer]   = useState<Record<number, Set<string>>>({})

  useEffect(() => { loadRoles() }, [])

  async function loadRoles() {
    setError(null)
    try {
      const r = await fetch(`${API}/roles`, { headers: authHeaders() }) // GET -> Role[]
      if (!r.ok) throw new Error(await r.text())
      const data: Role[] = await r.json()
      setRoles(data)
      const b: Record<number, Set<string>> = {}
      const e: Record<number, boolean> = {}
      data.forEach(role => { b[role.id] = new Set(role.permissions || []); e[role.id] = false })
      setBuffer(b); setEditing(e)
    } catch (e:any) { setError(e?.message ?? 'Failed to load roles') }
  }

  function togglePerm(roleId: number, perm: string) {
    setBuffer(prev => {
      const copy = { ...prev }
      const set = new Set(copy[roleId] ?? [])
      if (set.has(perm)) set.delete(perm); else set.add(perm)
      copy[roleId] = set
      return copy
    })
    setEditing(prev => ({ ...prev, [roleId]: true }))
  }

  function startEdit(roleId: number) {
    setEditing(prev => ({ ...prev, [roleId]: true }))
  }

  function cancelEdit(role: Role) {
    setBuffer(prev => ({ ...prev, [role.id]: new Set(role.permissions || []) }))
    setEditing(prev => ({ ...prev, [role.id]: false }))
  }

  async function saveRole(role: Role) {
    setBusy(true); setError(null)
    try {
      const perms = Array.from(buffer[role.id] ?? [])
      const r = await fetch(`${API}/roles/${role.id}`, {
        method: 'PATCH', headers: jsonHeaders(),
        body: JSON.stringify({ name: role.name, permissions: perms }),
      }) // returns updated Role
      if (!r.ok) throw new Error(await r.text())
      const updated: Role = await r.json()
      setRoles(prev => prev.map(x => x.id === updated.id ? updated : x))
      setBuffer(prev => ({ ...prev, [updated.id]: new Set(updated.permissions || []) }))
      setEditing(prev => ({ ...prev, [updated.id]: false }))
    } catch (e:any) { setError(e?.message ?? 'Failed to save role') }
    finally { setBusy(false) }
  }

  async function addRole() {
    const name = prompt('New role name?')
    if (!name) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`${API}/roles`, {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({ name, permissions: [] }),
      }) // returns created Role
      if (!r.ok) throw new Error(await r.text())
      const created: Role = await r.json()
      setRoles(prev => [...prev, created])
      setBuffer(prev => ({ ...prev, [created.id]: new Set([]) }))
      setEditing(prev => ({ ...prev, [created.id]: true }))
    } catch (e:any) { setError(e?.message ?? 'Failed to add role') }
    finally { setBusy(false) }
  }

  async function deleteRole(role: Role) {
    if (!confirm(`Delete role "${role.name}"?`)) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`${API}/roles/${role.id}`, {
        method: 'DELETE', headers: authHeaders(),
      }) // expect 204
      if (!r.ok && r.status !== 204) throw new Error(await r.text())
      setRoles(prev => prev.filter(x => x.id !== role.id))
      setBuffer(prev => { const c = { ...prev }; delete c[role.id]; return c })
      setEditing(prev => { const c = { ...prev }; delete c[role.id]; return c })
    } catch (e:any) { setError(e?.message ?? 'Failed to delete role') }
    finally { setBusy(false) }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Manage Roles</h2>
        <button onClick={addRole} className="border rounded-xl px-3 py-1.5" disabled={busy}>
          + Add Role
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="grid gap-4">
        {roles.map(role => {
          const set = buffer[role.id] ?? new Set<string>()
          const dirty =
            Array.isArray(role.permissions) &&
            JSON.stringify(Array.from(set).sort()) !== JSON.stringify(role.permissions.slice().sort())

          return (
            <div key={role.id} className="border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-medium text-lg">{role.name}</div>
                <div className="flex gap-2">
                  {dirty ? (
                    <>
                      <button className="px-3 py-1.5 border rounded-xl" onClick={() => cancelEdit(role)} disabled={busy}>
                        Cancel
                      </button>
                      <button
                        className="px-3 py-1.5 border rounded-xl bg-black text-white disabled:opacity-50"
                        onClick={() => saveRole(role)} disabled={busy}
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="px-3 py-1.5 border rounded-xl" onClick={() => startEdit(role.id)} disabled={busy}>
                        Edit
                      </button>
                      <button
                        className="px-3 py-1.5 border rounded-xl border-red-600 text-red-600"
                        onClick={() => deleteRole(role)} disabled={busy}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Permission matrix */}
              <div className="grid md:grid-cols-3 gap-4">
                {GROUPS.map(group => (
                  <div key={group} className="border rounded-xl p-3">
                    <div className="font-semibold text-sm mb-2">{group}</div>
                    <div className="space-y-2">
                      {ALL_PERMISSIONS.filter(p => p.group === group).map(p => (
                        <label key={p.key} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={set.has(p.key)}
                            onChange={() => togglePerm(role.id, p.key)}
                          />
                          <span>{p.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {roles.length === 0 && (
          <div className="text-sm text-gray-500 border rounded-2xl p-4">No roles.</div>
        )}
      </div>
    </section>
  )
}
