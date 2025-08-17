'use client'
import { getUser } from '@/lib/api'

export default function Topbar() {
  const u = getUser()
  const isMgr = u?.role === 'manager' || u?.role === 'admin'
  return (
    <div className="flex items-center gap-4 p-3 border-b">
      <a href="/" className="font-semibold">DVCR</a>
      <a href="/trucks" className="text-sm">Trucks</a>
      {isMgr && <a href="/admin" className="text-sm">Admin</a>}
      {isMgr && <a href="/users" className="text-sm">Users</a>}
      {isMgr && <a href="/admin/alerts" className="text-sm">Alerts</a>}
      <div className="flex-1" />
      {u ? (
        <>
          <span className="text-sm text-gray-600">{u.name} ({u.role})</span>
          <button
            onClick={() => { 
              localStorage.removeItem('token'); 
              localStorage.removeItem('user'); 
              window.location.href='/login' 
            }}
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
