'use client'
import { useEffect } from 'react'
import { getUser } from '@/lib/api'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = getUser()

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
    }
  }, [user])

  if (!user) return null // prevent flash of content before redirect

  return <>{children}</>
}
