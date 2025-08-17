'use client'

import { useEffect, useState } from 'react'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'

interface User {
  id: number
  username: string
  role: string
  active: boolean
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<string[]>([])

  useEffect(() => {
    loadUsers()
    loadRoles()
  }, [])

  async function loadUsers() {
    const r = await fetch('/api/users', { credentials: 'include' })
    if (r.ok) setUsers(await r.json())
  }

  async function loadRoles() {
    const r = await fetch('/api/roles', { credentials: 'include' })
    if (r.ok) {
      const data = await r.json()
      setRoles(data.map((x: any) => x.name))
    }
  }

  async function setUserRole(u: User, newRole: string) {
    const r = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ role: newRole }),
    })
    if (r.ok) loadUsers()
  }

  return (
    <RequireAuth>
      <RoleGuard roles={['admin']}>
        <h1 className="text-xl font-bold mb-4">User Management</h1>
        <table className="table-auto w-full border">
          <thead>
            <tr>
              <th className="border px-2 py-1">ID</th>
              <th className="border px-2 py-1">Username</th>
              <th className="border px-2 py-1">Role</th>
              <th className="border px-2 py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="border px-2 py-1">{u.id}</td>
                <td className="border px-2 py-1">{u.username}</td>
                <td className="border px-2 py-1">
                  <select
                    value={u.role}
                    onChange={(e) => setUserRole(u, e.target.value)}
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="border px-2 py-1">
                  {u.active ? 'Active' : 'Inactive'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </RoleGuard>
    </RequireAuth>
  )
}
