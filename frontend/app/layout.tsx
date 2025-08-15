import './globals.css'
import React from 'react'

export const metadata = {
  title: 'DVCR',
  description: 'Driver Vehicle Condition Report',
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
      <body className="min-h-screen bg-white text-gray-900">{children}</body>
    </html>
  )
}
