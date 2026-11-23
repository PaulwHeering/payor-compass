import { FIELD_SOURCE_INFO, fieldSource } from '@/lib/research/scope'

// Small tag that says how a field gets its value: researched by Claude, or filled from uploaded files.
export default function SourceBadge({ sectionKey, fieldKey }: { sectionKey: string; fieldKey: string }) {
  const info = FIELD_SOURCE_INFO[fieldSource(sectionKey, fieldKey)]
  return (
    <span
      title={info.title}
      className={`ml-2 inline-block align-middle px-2 py-0.5 text-[11px] font-semibold rounded-md ${info.className}`}
    >
      {info.label}
    </span>
  )
}
