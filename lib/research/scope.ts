// Which fields Claude may research on the internet.
//
// Source of truth: "Payer Profile - Categories & Contents" (the team's field list). Every field there is
// marked "Research on internet", "Don't research on internet", "If Medicaid... / If commercial..." or HOLD.
// Only the first group is researched here. The "don't research" fields will be filled by a separate process
// where the team gives us files to read; they must never be searched for on the web.
//
// Fields are identified as "section_key.field_key" because some keys repeat across sections
// (for example grievances and escalation_path).
//
// This file is imported by the research engine, the API routes and the Research page, and it is
// mirrored in CLAUDE.md and the research-payer skill. Change all of them together.

export const RESEARCHABLE_FIELDS: ReadonlySet<string> = new Set([
  // Links
  'links.provider_portal',
  'links.provider_manual',
  'links.clinical_policy',
  'links.billing_manual',

  // Staff & Coding
  'staff_coding.supervision_billing_rules',
  'staff_coding.required_modifiers',
  'staff_coding.cap_daily',
  'staff_coding.cap_weekly',
  'staff_coding.cap_monthly',
  'staff_coding.cap_auth_duration',
  'staff_coding.telehealth_allowance',
  'staff_coding.telehealth_requirements',

  // Authorizations
  'authorizations.forms',
  'authorizations.submission_process',
  'authorizations.required_diagnoses',
  'authorizations.restricted_diagnoses',
  'authorizations.supporting_documentation',
  'authorizations.submission_timelines',
  'authorizations.turnaround_timelines',
  'authorizations.peer_to_peer',
  'authorizations.medical_necessity',
  'authorizations.appeals',
  'authorizations.grievances',

  // Credentialing
  'credentialing.levels_requiring_credentialing',
  'credentialing.process_turnaround',
  'credentialing.revalidation',
  'credentialing.staff_termination',
  'credentialing.training_background_monitoring',
  'credentialing.education_requirements',
  'credentialing.escalation_path',

  // Billing
  'billing.fee_schedule_status',
  'billing.claims_submission',
  'billing.timely_filing_limit',
  'billing.initial_billing_timeline',
  'billing.clean_claim_payment_timeline',
  'billing.cob',
  'billing.overpayment',
  'billing.grievances',
  'billing.escalation_path',
])

// Deliberately NOT researched (kept here so the reason is not lost):
// - profile.*                              : "Don't research on internet" (TIN, states, contract dates, terms, contacts)
// - credentialing.contracting_model        : "Don't research on internet"
// - billing.eft / claim_form / waystar_id / claims_address : "Don't research on internet"
// - billing.fee_schedule_link              : restricted-access link, supplied by the team
// - staff_coding.contracted_codes / staff_level_per_code : research only for Medicaid; for commercial the
//                                            team supplies them. The app has no line-of-business setting
//                                            yet, so these are off until that exists.
// - clinical_services.*                    : on HOLD until the fields are defined

export function isResearchable(sectionKey: string, fieldKey: string): boolean {
  return RESEARCHABLE_FIELDS.has(`${sectionKey}.${fieldKey}`)
}

export const NOT_RESEARCHABLE_MESSAGE =
  'This field is not researched on the internet. It is filled from files the team provides.'

// How each field gets its value. Shown as a badge next to every field in the app.
//   internet : Claude researches it on the web (the allowlist above)
//   medicaid : web research for Medicaid payers; for commercial payers the team supplies it from files
//   file     : filled from contracts or other files the team uploads
//   hold     : not defined yet
export type FieldSource = 'internet' | 'medicaid' | 'file' | 'hold'

export function fieldSource(sectionKey: string, fieldKey: string): FieldSource {
  if (isResearchable(sectionKey, fieldKey)) return 'internet'
  if (sectionKey === 'staff_coding' && (fieldKey === 'contracted_codes' || fieldKey === 'staff_level_per_code')) return 'medicaid'
  if (sectionKey === 'clinical_services') return 'hold'
  return 'file'
}

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
