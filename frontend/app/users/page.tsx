import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'

export default function UsersPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <main className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">User Management</h1>
            <Link href="/admin/roles" className="border rounded-xl px-3 py-1.5">Roles & Permissions</Link>
          </div>
          {/* User management table here */}
        </main>
      </RoleGuard>
    </RequireAuth>
  )
}
