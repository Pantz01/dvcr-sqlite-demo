'use client'
import { useState, useEffect } from 'react'
import { API } from '@/lib/api'

export default function Login() {
  // If a demo token/user were saved earlier, clear them
  useEffect(() => {
    localStorage.removeItem('x-user-id')
  }, [])

  const [email, setEmail] = useState('manager@example.com')
  const [password, setPassword] = useState('password123')
  const [busy, setBusy] = useState(false)

  async function doLogin(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      if (!r.ok) {
        const msg = await r.text().catch(()=>'Login failed')
        alert(msg || 'Login failed'); return
      }
      const data = await r.json()
      localStorage.setItem('token', data.access_token)
      localStorage.setItem('user', JSON.stringify(data.user))
      window.location.href = '/trucks'
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="p-6 max-w-md mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <form onSubmit={doLogin} className="grid gap-2">
        <input className="border p-2 rounded-xl" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" />
        <input className="border p-2 rounded-xl" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" />
        <button className="border rounded-xl p-2" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="text-xs text-gray-600">manager@example.com / password123</p>
      <p className="text-xs text-gray-600">driver@example.com / password123</p>
      <p className="text-xs text-gray-600">mechanic@example.com / password123</p>
    </main>
  )
}
