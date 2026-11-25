// How each field gets its value. Stored in field_definitions.source_mode and edited by admins on
// /admin/field-sources. The starting values came from the team's "Payer Profile - Categories & Contents"
// list (see the migration 20261123000009_field_source_mode.sql).
//
//   internet : Claude researches it on the web.
//   medicaid : web research for Medicaid payers; for commercial payers the team supplies it from files.
//              Not researched yet: the app has no line-of-business setting.
//   file     : filled from contracts or other files the team uploads. Never searched on the web. Claude may
//              read the payer's uploaded PDFs (payer_files) and propose values quoted from them.
//   hold     : not defined yet. Never researched.
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

// "file" fields are researched only in the payer's uploaded files, never on the web.
export function isFileResearchable(sourceMode: string | null | undefined): boolean {
  return sourceMode === 'file'
}

// How Claude researches a field, or null if it may not research it at all.
export function researchMethod(sourceMode: string | null | undefined): 'internet' | 'file' | null {
  if (isResearchable(sourceMode)) return 'internet'
  if (isFileResearchable(sourceMode)) return 'file'
  return null
}

export const NOT_RESEARCHABLE_MESSAGE =
  'This field is not researched by Claude (it is on hold or set to "Web if Medicaid, files if commercial").'

export const NO_FILES_MESSAGE =
  'This payer has no uploaded files yet. Upload a PDF on the payer page first, then research the "From uploaded files" fields.'

// Findings quoted from an uploaded file store this in source_url (plus source_file_id).
export const FILE_SOURCE_PREFIX = 'uploaded-file:'

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
    title: 'Never searched on the internet. Filled from contracts or other files the team uploads; Claude can read those files and propose values for review.',
    className: 'bg-amber-100 text-amber-800',
  },
  hold: {
    label: 'On hold',
    title: 'This field is not defined yet.',
    className: 'bg-slate-100 text-slate-600',
  },
}
