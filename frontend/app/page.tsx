'use client'
import { useEffect } from 'react'
import { getUser } from '@/lib/api'
import { redirect } from 'next/navigation'

export default function Home() {
  // Client-side because token/user live in localStorage
  useEffect(() => {
    const u = getUser()
    if (!u) {
      window.location.replace('/login')
      return
    }
    if (u.role === 'manager' || u.role === 'admin') {
      window.location.replace('/admin')
    } else {
      window.location.replace('/trucks')
    }
  }, [])

  // Small placeholder while redirecting
  return <main className="p-6">Loading…</main>
}
