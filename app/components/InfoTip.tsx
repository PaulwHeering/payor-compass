'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

// A small circled "i" that opens a short explanation when clicked. Click again, click elsewhere or
// press Escape to close it.
// Use align="right" near the right edge of the page so the box opens leftwards and stays on screen.
export default function InfoTip({
  label,
  align = 'left',
  children,
}: {
  label: string
  align?: 'left' | 'right'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={ref} className="relative inline-flex align-middle normal-case font-normal tracking-normal">
      <button
        type="button"
        onClick={e => {
          // Don't let the click reach a surrounding label (it would toggle its checkbox).
          e.preventDefault()
          e.stopPropagation()
          setOpen(o => !o)
        }}
        aria-label={`What is "${label}"?`}
        aria-expanded={open}
        aria-controls={id}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] font-bold italic leading-none text-slate-500 hover:border-blue-600 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-6 z-20 w-72 rounded-lg border border-slate-200 bg-white p-3 text-left text-sm text-slate-700 shadow-lg`}
        >
          <span className="mb-1 block font-semibold text-slate-900">{label}</span>
          {children}
        </span>
      )}
    </span>
  )
}
