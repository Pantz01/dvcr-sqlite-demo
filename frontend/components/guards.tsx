'use client'
import { ReactNode, useEffect, useState } from 'react'
import { getUser } from '@/lib/api'

export function RequireAuth({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    const u = getUser()
    if (!u) window.location.href = '/login'
    else setOk(true)
  }, [])
  if (!ok) return null
  return <>{children}</>
}

export function RoleGuard({ roles, children }: { roles: string[], children: ReactNode }) {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    const u = getUser()
    setAllowed(!!u && roles.includes(u.role))
  }, [roles])
  if (!allowed) return null
  return <>{children}</>
}
