'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders } from '@/lib/api'

type User = {
  id: number
  name: string
  email: string
  role: string
}

type RoleOut = { id: number; name: string; permissions: string[] }

export default function UsersPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <main className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">User Management</h1>
            <Link href="/admin/roles" className="border rounded-xl px-3 py-1.5">
              Roles & Permissions
            </Link>
          </div>

          <UsersManager />
        </main>
      </RoleGuard>
    </RequireAuth>
  )
}

function UsersManager() {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadUsers()
    loadRoles()
  }, [])

  async function loadUsers() {
    setError(null)
    try {
      const r = await fetch(`${API}/users`, { headers: authHeaders() })
      if (!r.ok) throw new Error(await r.text())
      setUsers(await r.json())
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load users')
    }
  }

  async function loadRoles() {
    try {
      const r = await fetch(`${API}/roles`, { headers: authHeaders() })
      if (!r.ok) {
        // if managers can’t read roles on your server, this may 403—fallback to empty
        setRoles([])
        return
      }
      const data: RoleOut[] = await r.json()
      setRoles(data.map(x => x.name))
    } catch {
      setRoles([])
    }
  }

  async function addUser() {
    const name = prompt('Name?')
    if (!name) return
    const email = prompt('Email?')
    if (!email) return
    const role = prompt(`Role? (one of: ${roles.join(', ') || 'driver/mechanic/manager/admin'})`) || 'viewer'
    const password = prompt('Temporary password?')
    if (!password) return

    setBusy(true)
    try {
      const r = await fetch(`${API}/users`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name, email, role, password }),
      })
      if (!r.ok) throw new Error(await r.text())
      await loadUsers()
    } catch (e: any) {
      alert(e?.message ?? 'Failed to add user')
    } finally {
      setBusy(false)
    }
  }

  async function updateUser(u: User, patch: Partial<User> & { password?: string }) {
    setBusy(true)
    try {
      const r = await fetch(`${API}/users/${u.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(patch),
      })
      if (!r.ok) throw new Error(await r.text())
      await loadUsers()
    } catch (e: any) {
      alert(e?.message ?? 'Failed to update user')
    } finally {
      setBusy(false)
    }
  }

  async function deleteUser(u: User) {
    if (!confirm(`Delete ${u.email}?`)) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/users/${u.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!r.ok && r.status !== 204) throw new Error(await r.text())
      await loadUsers()
    } catch (e: any) {
      alert(e?.message ?? 'Failed to delete user')
    } finally {
      setBusy(false)
    }
  }

  async function setUserRole(u: User, newRole: string) {
    await updateUser(u, { role: newRole })
  }

  function promptEditName(u: User) {
    const name = prompt('New name:', u.name)
    if (name != null && name !== u.name) updateUser(u, { name })
  }

  function promptEditEmail(u: User) {
    const email = prompt('New email:', u.email)
    if (email != null && email !== u.email) updateUser(u, { email })
  }

  function promptSetPassword(u: User) {
    const pw = prompt(`Set new password for ${u.email}:`)
    if (pw) updateUser(u, { password: pw } as any)
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {users.length} user{users.length === 1 ? '' : 's'}
        </div>
        <button className="border rounded-xl px-3 py-1.5" onClick={addUser} disabled={busy}>
          + Add User
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="border rounded-2xl overflow-hidden">
        <div className="p-3 font-semibold border-b">Users</div>
        <div className="max-h-[65vh] overflow-auto divide-y">
          {users.map(u => (
            <div key={u.id} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{u.email}</div>
                <div className="text-xs text-gray-600 flex flex-wrap items-center gap-2">
                  <span className="truncate">Name: {u.name || '—'}</span>
                  <span className="opacity-50">•</span>
                  <span>Role:</span>
                  <select
                    className="border rounded px-1 py-0.5 text-xs"
                    value={u.role}
                    onChange={(e) => setUserRole(u, e.target.value)}
                  >
                    {!roles.includes(u.role) && <option value={u.role}>{u.role}</option>}
                    {roles.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                    {/* fallback defaults if roles endpoint is empty */}
                    {roles.length === 0 && ['driver','mechanic','manager','admin'].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 border rounded-xl" onClick={() => promptEditName(u)} disabled={busy}>
                  Edit Name
                </button>
                <button className="px-3 py-1.5 border rounded-xl" onClick={() => promptEditEmail(u)} disabled={busy}>
                  Edit Email
                </button>
                <button className="px-3 py-1.5 border rounded-xl" onClick={() => promptSetPassword(u)} disabled={busy}>
                  Set Password
                </button>
                <button
                  className="px-3 py-1.5 border rounded-xl border-red-600 text-red-600"
                  onClick={() => deleteUser(u)}
                  disabled={busy}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="p-3 text-sm text-gray-500">No users.</div>
          )}
        </div>
      </div>
    </section>
  )
}
