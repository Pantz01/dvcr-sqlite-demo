import RequireAuth from '@/components/RequireAuth'
import RoleGuard from '@/components/RoleGuard'

export default function UsersPage() {
  return (
    <RequireAuth>
      <RoleGuard roles={['manager', 'admin']}>
        <h1>User Management</h1>
        {/* User management table here */}
      </RoleGuard>
    </RequireAuth>
  )
}
