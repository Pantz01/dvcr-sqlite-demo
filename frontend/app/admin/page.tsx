'use client'
import { useEffect, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders, getUser } from '@/lib/api'

type UserRow = {
  id: number
  name: string
  email: string
  role: 'driver' | 'mechanic' | 'manager' | 'admin'
}

export default function AdminPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <AdminInner />
      </RoleGuard>
    </RequireAuth>
  )
}

function AdminInner() {
  const me = getUser()
  const [users, setUsers] = useState<UserRow[]>([])
  const [busy, setBusy] = useState(false)

  async function loadUsers() {
    const r = await fetch(`${API}/users`, { headers: authHeaders() })
    if (!r.ok) { alert(await r.text().catch(()=> 'Failed to load users')); return }
    setUsers(await r.json())
  }
  useEffect(() => { loadUsers() }, [])

  async function createUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    const fd = new FormData(e.currentTarget)
    const body = Object.fromEntries(Array.from(fd.entries())) as any
    const r = await fetch(`${API}/users`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: body.name,
        email: body.email,
        role: body.role,
        password: body.password || 'password123',
      })
    })
    setBusy(false)
    if (!r.ok) { alert(await r.text()); return }
    e.currentTarget.reset()
    loadUsers()
  }

  async function patchUser(u: UserRow, patch: Partial<UserRow> & { password?: string }) {
    const r = await fetch(`${API}/users/${u.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(patch),
    })
    if (!r.ok) { alert(await r.text()); return }
    loadUsers()
  }

  async function resetPassword(u: UserRow) {
    const p = prompt(`New password for ${u.email}:`, 'password123')
    if (!p) return
    await patchUser(u, { password: p } as any)
    alert('Password updated.')
  }

  async function removeUser(u: UserRow) {
    if (!confirm(`Delete ${u.email}?`)) return
    const r = await fetch(`${API}/users/${u.id}`, { method: 'DELETE', headers: authHeaders() })
    if (!r.ok && r.status !== 204) { alert(await r.text()); return }
    loadUsers()
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Control Panel</h1>
        <div className="text-sm text-gray-600">Signed in as {me?.name} ({me?.role})</div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <a href="/trucks" className="p-4 border rounded-2xl hover:bg-gray-50">
          <div className="font-semibold">Trucks</div>
          <div className="text-sm text-gray-600">Manage fleet & reports</div>
        </a>
        <a href="/reports" className="p-4 border rounded-2xl hover:bg-gray-50">
          <div className="font-semibold">Reports</div>
          <div className="text-sm text-gray-600">Browse DVCR history</div>
        </a>
        <a href="/admin" className="p-4 border rounded-2xl hover:bg-gray-50">
          <div className="font-semibold">Users</div>
          <div className="text-sm text-gray-600">Create, edit, reset, delete</div>
        </a>
      </div>

      {/* Quick Add User */}
      <section className="border rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Quick Add User</div>
        <form onSubmit={createUser} className="grid sm:grid-cols-5 gap-2">
          <input name="name" placeholder="Name" className="border p-2 rounded-xl" required />
          <input name="email" placeholder="Email" className="border p-2 rounded-xl" required />
          <select name="role" className="border p-2 rounded-xl">
            <option value="driver">driver</option>
            <option value="mechanic">mechanic</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>
          <input name="password" placeholder="Password (optional)" className="border p-2 rounded-xl" />
          <button disabled={busy} className="border rounded-xl p-2">{busy ? 'Adding…' : 'Add'}</button>
        </form>
      </section>

      {/* Users Table */}
      <section className="border rounded-2xl p-4">
        <div className="font-semibold mb-2">Users</div>
        <div className="overflow-auto">
          <table className="min-w-[700px] w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Email</th>
                <th className="text-left p-2">Role</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t">
                  <td className="p-2">
                    <input
                      defaultValue={u.name}
                      className="border p-1 rounded"
                      onBlur={(e)=>patchUser(u,{ name: e.target.value })}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      defaultValue={u.email}
                      className="border p-1 rounded"
                      onBlur={(e)=>patchUser(u,{ email: e.target.value })}
                    />
                  </td>
                  <td className="p-2">
                    <select
                      defaultValue={u.role}
                      className="border p-1 rounded"
                      onChange={(e)=>patchUser(u,{ role: e.target.value as UserRow['role'] })}
                    >
                      {['driver','mechanic','manager','admin'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="p-2 space-x-2">
                    <button className="underline text-sm" onClick={()=>resetPassword(u)}>Reset password</button>
                    <button className="underline text-sm text-red-600" onClick={()=>removeUser(u)}>Delete</button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-2 text-sm text-gray-500">No users yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
