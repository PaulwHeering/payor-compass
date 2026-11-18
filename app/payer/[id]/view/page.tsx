'use client'

import { Suspense } from 'react'
import PayerViewer from './PayerViewer'

export default function PayerViewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p>Loading...</p></div>}>
      <PayerViewer />
    </Suspense>
  )
}
