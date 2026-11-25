// The Payer Compass mark: a white compass in a navy circle. The favicon (app/icon.svg) is the same drawing.
// `bare` drops the circle, leaving just the white compass for dark backgrounds such as the sidebar. The
// needle's centre dot is a cut-out (evenodd), so it shows whatever is behind it.
export default function CompassLogo({ className = 'w-8 h-8', bare = false }: { className?: string; bare?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      {!bare && <circle cx="32" cy="32" r="32" fill="#0C2340" />}
      <circle cx="32" cy="32" r={bare ? 27 : 21} fill="none" stroke="#fff" strokeWidth={bare ? 5 : 4} />
      <path
        fillRule="evenodd"
        fill="#fff"
        d={
          bare
            ? 'M44 20 36.5 36.5 20 44 27.5 27.5Z M35 32a3 3 0 1 1-6 0 3 3 0 1 1 6 0Z'
            : 'M41 23 35.5 35.5 23 41 28.5 28.5Z M34.5 32a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0Z'
        }
      />
    </svg>
  )
}
