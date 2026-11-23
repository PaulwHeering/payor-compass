// How each field gets its value. Stored in field_definitions.source_mode and edited by admins on
// /admin/field-sources. The starting values came from the team's "Payer Profile - Categories & Contents"
// list (see the migration 20261123000009_field_source_mode.sql).
//
//   internet : Claude researches it on the web. The ONLY mode the research engine will run.
//   medicaid : web research for Medicaid payers; for commercial payers the team supplies it from files.
//              Not researched yet: the app has no line-of-business setting.
//   file     : filled from contracts or other files the team uploads. Never searched on the web.
//   hold     : not defined yet. Never searched on the web.
//
// This file is imported by the research engine, the API routes and the pages. The rule is also written
// in CLAUDE.md and the research-payer skill.

export const FIELD_SOURCES = ['internet', 'medicaid', 'file', 'hold'] as const
export type FieldSource = (typeof FIELD_SOURCES)[number]

export function isFieldSource(value: unknown): value is FieldSource {
  return typeof value === 'string' && (FIELD_SOURCES as readonly string[]).includes(value)
}

// Only "internet" fields are researched on the web.
export function isResearchable(sourceMode: string | null | undefined): boolean {
  return sourceMode === 'internet'
}

export const NOT_RESEARCHABLE_MESSAGE =
  'This field is not researched on the internet. It is filled from files the team provides.'

export const FIELD_SOURCE_INFO: Record<FieldSource, { label: string; title: string; className: string }> = {
  internet: {
    label: 'Researched by Claude',
    title: 'Claude searches the internet for this and proposes a sourced value for your review.',
    className: 'bg-blue-100 text-blue-700',
  },
  medicaid: {
    label: 'Web if Medicaid · files if commercial',
    title: 'Researched on the internet for Medicaid payers. For commercial payers the team provides it from files.',
    className: 'bg-violet-100 text-violet-700',
  },
  file: {
    label: 'From uploaded files',
    title: 'Not researched on the internet. Filled from contracts or other files the team provides.',
    className: 'bg-amber-100 text-amber-800',
  },
  hold: {
    label: 'On hold',
    title: 'This field is not defined yet.',
    className: 'bg-slate-100 text-slate-600',
  },
}
