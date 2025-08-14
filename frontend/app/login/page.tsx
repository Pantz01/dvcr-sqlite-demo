'use client'
import { useRouter } from 'next/navigation'

export default function Login() {
  const router = useRouter()
  const users = [
    { id: 1, name: 'Alice Driver' },
    { id: 2, name: 'Manny Manager' },
    { id: 3, name: 'Mec McWrench' },
  ]

  return (
    <main className="p-6 max-w-md mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Sign in (MVP)</h1>
      <p className="text-sm text-gray-600">Select a demo user. Real auth comes later.</p>
      <div className="grid gap-2">
        {users.map(u => (
          <button key={u.id} className="border rounded-xl p-3 hover:bg-gray-50"
            onClick={() => { localStorage.setItem('x-user-id', String(u.id)); router.push('/trucks'); }}>
            Continue as {u.name}
          </button>
        ))}
      </div>
    </main>
  )
}
