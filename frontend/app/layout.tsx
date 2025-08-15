import './globals.css'
import Topbar from '@/components/Topbar'

export const metadata = {
  title: 'DVCR',
  description: 'Driver Vehicle Condition Reports'
}
// inside <body> or header area
<button
  onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href='/login' }}
  className="text-sm text-gray-600 underline"
>
  Logout
</button>
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Topbar />
        {children}
      </body>
    </html>
  )
}
