'use client'
import { getUser } from '@/lib/api'

export default function RoleGuard({
  roles,
  children
}: {
  roles: string[],
  children: React.ReactNode
}) {
  const user = getUser()

  if (!user || !roles.includes(user.role)) {
    return <p className="p-4 text-red-500">Access Denied</p>
  }

  return <>{children}</>
}
