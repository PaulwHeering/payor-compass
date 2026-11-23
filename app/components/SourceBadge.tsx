import { FIELD_SOURCE_INFO, isFieldSource } from '@/lib/research/scope'

// Small tag that says how a field gets its value: researched by Claude, or filled from uploaded files.
export default function SourceBadge({ mode }: { mode: string | null | undefined }) {
  const info = FIELD_SOURCE_INFO[isFieldSource(mode) ? mode : 'file']
  return (
    <span
      title={info.title}
      className={`ml-2 inline-block align-middle px-2 py-0.5 text-[11px] font-semibold rounded-md ${info.className}`}
    >
      {info.label}
    </span>
  )
}
