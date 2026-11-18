'use client'

import { Suspense } from 'react'
import PayerForm from './PayerForm'

export default function PayerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p>Loading...</p></div>}>
      <PayerForm />
    </Suspense>
  )
}
