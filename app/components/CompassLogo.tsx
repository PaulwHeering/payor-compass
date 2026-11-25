// The Payor Compass mark: a white compass in a blue circle. The favicon (app/icon.svg) is the same drawing.
export default function CompassLogo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="#0C2340" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="#fff" strokeWidth="4" />
      <path d="M41 23 35.5 35.5 23 41 28.5 28.5Z" fill="#fff" />
      <circle cx="32" cy="32" r="2.5" fill="#0C2340" />
    </svg>
  )
}
