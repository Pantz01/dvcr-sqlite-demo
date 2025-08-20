'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'
import { API, authHeaders, jsonHeaders, getUser } from '@/lib/api'

type UserRow = {
  id: number
  name: string
  email: string
  role: string
}

type RoleOut = { id: number; name: string; permissions: string[] }

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
  const router = useRouter()

  const [users, setUsers] = useState<UserRow[]>([])
  const [busy, setBusy] = useState(false)
  const [pmAlertCount, setPmAlertCount] = useState<number>(0)
  const [roles, setRoles] = useState<string[]>([])

  const [editing, setEditing] = useState<Record<number, boolean>>({})
  const [draft, setDraft] = useState<Record<number, UserRow>>({})

  async function loadUsers() {
    const r = await fetch(`${API}/users`, { headers: authHeaders() })
    if (!r.ok) { alert(await r.text().catch(()=> 'Failed to load users')); return }
    const data: UserRow[] = await r.json()
    setUsers(data)
    const e: Record<number, boolean> = {}
    const d: Record<number, UserRow> = {}
    data.forEach(u => { e[u.id] = false; d[u.id] = { ...u } })
    setEditing(e); setDraft(d)
  }

  async function loadRoles() {
    try {
      const r = await fetch(`${API}/roles`, { headers: authHeaders() })
      if (!r.ok) { setRoles([]); return }
      const data: RoleOut[] = await r.json()
      const names = data.map(x => x.name).filter(n => n !== 'admin')
      setRoles(names)
    } catch {
      setRoles([])
    }
  }

  async function loadPmAlertCount() {
    const tryUrls = [`${API}/alerts/pm-with-appts`, `${API}/alerts/pm`]
    for (const url of tryUrls) {
      const r = await fetch(url, { headers: authHeaders() })
      if (r.ok) {
        const data = await r.json()
        setPmAlertCount(Array.isArray(data) ? data.length : 0)
        return
      }
    }
    setPmAlertCount(0)
  }

  useEffect(() => {
    loadUsers()
    loadRoles()
    loadPmAlertCount()
  }, [])

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
  }

  async function saveRow(u: UserRow) {
    const d = draft[u.id]
    if (!d) return
    setBusy(true)
    try {
      const patch: Partial<UserRow> = {}
      if (d.name !== u.name) patch.name = d.name
      if (d.email !== u.email) patch.email = d.email
      if (d.role !== u.role) patch.role = d.role
      if (Object.keys(patch).length > 0) {
        await patchUser(u, patch)
      }
      await loadUsers()
      setEditing(prev => ({ ...prev, [u.id]: false }))
    } finally {
      setBusy(false)
    }
  }

  function startEdit(u: UserRow) {
    setEditing(prev => ({ ...prev, [u.id]: true }))
    setDraft(prev => ({ ...prev, [u.id]: { ...u } }))
  }

  function cancelEdit(u: UserRow) {
    setDraft(prev => ({ ...prev, [u.id]: { ...u } }))
    setEditing(prev => ({ ...prev, [u.id]: false }))
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

  const roleOptions = [...roles, 'admin']

  const TileButton = ({
    onClick,
    title,
    subtitle,
    badge,
  }: {
    onClick: () => void
    title: string
    subtitle: string
    badge?: number
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="relative flex flex-col items-start p-4 border rounded-2xl hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200 text-left"
    >
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-gray-600">{subtitle}</div>
      {typeof badge === 'number' && badge > 0 && (
        <span
          className="absolute top-3 right-3 inline-flex items-center justify-center text-xs font-semibold px-2 py-1 rounded-full bg-red-600 text-white"
        >
          {badge}
        </span>
      )}
    </button>
  )

  return (
    <main className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Control Panel</h1>
        <div />
      </div>

      {/* Primary buttons: Trucks + PM first, then Reports, Users */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
        <TileButton
          onClick={() => router.push('/admin/trucks')}
          title="Trucks"
          subtitle="Manage fleet & PM service"
        />
        <TileButton
          onClick={() => router.push('/admin/pm')}
          title="PM Alerts & Scheduling"
          subtitle="See due-soon trucks and book shop dates"
          badge={pmAlertCount}
        />
        <TileButton
          onClick={() => router.push('/reports')}
          title="Reports"
          subtitle="Browse & manage issues"
        />
        <TileButton
          onClick={() => router.push('/users')}
          title="Users"
          subtitle="Create, edit, reset, delete"
        />
      </div>

      {/* Quick Add User */}
      <section className="border rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Quick Add User</div>
        <form onSubmit={createUser} className="grid sm:grid-cols-5 gap-2">
          <input name="name" placeholder="Name" className="border p-2 rounded-xl" required />
          <input name="email" placeholder="Email" className="border p-2 rounded-xl" required />
          <select name="role" className="border p-2 rounded-xl">
            {roles.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
            <option value="admin">admin</option>
          </select>
          <input name="password" placeholder="Password (optional)" className="border p-2 rounded-xl" />
          <button
            disabled={busy}
            className="inline-flex items-center justify-center px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-60"
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
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
              {users.map(u => {
                const isEditing = !!editing[u.id]
                const d = draft[u.id] ?? u
                return (
                  <tr key={u.id} className="border-t">
                    <td className="p-2">
                      <input
                        value={isEditing ? d.name : u.name}
                        readOnly={!isEditing}
                        onChange={(e)=> setDraft(prev => ({ ...prev, [u.id]: { ...(prev[u.id] ?? u), name: e.target.value } }))}
                        className={`border p-1 rounded w-full ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={isEditing ? d.email : u.email}
                        readOnly={!isEditing}
                        onChange={(e)=> setDraft(prev => ({ ...prev, [u.id]: { ...(prev[u.id] ?? u), email: e.target.value } }))}
                        className={`border p-1 rounded w-full ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={isEditing ? d.role : u.role}
                        disabled={!isEditing}
                        onChange={(e)=> setDraft(prev => ({ ...prev, [u.id]: { ...(prev[u.id] ?? u), role: e.target.value } }))}
                        className={`border p-1 rounded ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      >
                        {!roleOptions.includes(u.role) && <option value={u.role}>{u.role}</option>}
                        {roleOptions.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      {!isEditing ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center px-2.5 py-1 text-xs border rounded-md hover:bg-gray-50"
                            onClick={()=>startEdit(u)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center px-2.5 py-1 text-xs border rounded-md hover:bg-gray-50"
                            onClick={()=>resetPassword(u)}
                          >
                            Reset password
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center px-2.5 py-1 text-xs border rounded-md hover:bg-red-50 text-red-700 border-red-300"
                            onClick={()=>removeUser(u)}
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center px-2.5 py-1 text-xs border rounded-md hover:bg-gray-50"
                            onClick={()=>cancelEdit(u)}
                            disabled={busy}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center px-2.5 py-1 text-xs border rounded-md hover:bg-green-50 text-green-700 border-green-300 disabled:opacity-60"
                            onClick={()=>saveRow(u)}
                            disabled={busy}
                          >
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
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
