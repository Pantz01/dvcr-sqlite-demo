import './globals.css'
import Topbar from '@/components/Topbar'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'DVCR',
  description: 'Driver Vehicle Condition Reports',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Topbar />
        {children}
      </body>
    </html>
  )
}
