import './globals.css'
import Topbar from '@/components/Topbar'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'FleetVision',
  description: 'See every issue. Solve every problem.',
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
