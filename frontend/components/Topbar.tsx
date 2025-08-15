'use client'
import { getUser } from '@/lib/api'

export default function Topbar() {
  const u = getUser()
  return (
    <div className="flex items-center gap-4 p-3 border-b">
      <a href="/trucks" className="font-semibold">DVCR</a>
      <div className="flex-1" />
      {u?.role && (u.role === 'manager' || u.role === 'admin') && (
        <a href="/users" className="text-sm underline">Users</a>
      )}
      {u ? (
        <>
          <span className="text-sm text-gray-600">{u.name} ({u.role})</span>
          <button
            onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href='/login' }}
            className="text-sm underline"
          >
            Logout
          </button>
        </>
      ) : (
        <a href="/login" className="text-sm underline">Login</a>
      )}
    </div>
  )
}
