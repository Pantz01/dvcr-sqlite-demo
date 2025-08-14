import './globals.css'
import React from 'react'

export const metadata = {
  title: 'DVCR',
  description: 'Driver Vehicle Condition Report',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900">{children}</body>
    </html>
  )
}
