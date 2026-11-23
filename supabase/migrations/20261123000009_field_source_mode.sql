-- How each field gets its value. Edited by admins on /admin/field-sources.
--   internet : Claude researches it on the web (the only mode the research engine will run)
--   medicaid : web research for Medicaid payers; commercial comes from team files (not researched yet:
--              the app has no line-of-business setting)
--   file     : filled from contracts or other files the team uploads
--   hold     : not defined yet
alter table field_definitions
  add column source_mode text not null default 'file'
  check (source_mode in ('internet', 'medicaid', 'file', 'hold'));

-- Starting values come from the team's "Payer Profile - Categories & Contents" list.
update field_definitions set source_mode = 'internet' where (section_key, key) in (
  ('links','provider_portal'), ('links','provider_manual'), ('links','clinical_policy'), ('links','billing_manual'),
  ('staff_coding','supervision_billing_rules'), ('staff_coding','required_modifiers'),
  ('staff_coding','cap_daily'), ('staff_coding','cap_weekly'), ('staff_coding','cap_monthly'),
  ('staff_coding','cap_auth_duration'), ('staff_coding','telehealth_allowance'), ('staff_coding','telehealth_requirements'),
  ('authorizations','forms'), ('authorizations','submission_process'), ('authorizations','required_diagnoses'),
  ('authorizations','restricted_diagnoses'), ('authorizations','supporting_documentation'),
  ('authorizations','submission_timelines'), ('authorizations','turnaround_timelines'),
  ('authorizations','peer_to_peer'), ('authorizations','medical_necessity'), ('authorizations','appeals'),
  ('authorizations','grievances'),
  ('credentialing','levels_requiring_credentialing'), ('credentialing','process_turnaround'),
  ('credentialing','revalidation'), ('credentialing','staff_termination'),
  ('credentialing','training_background_monitoring'), ('credentialing','education_requirements'),
  ('credentialing','escalation_path'),
  ('billing','fee_schedule_status'), ('billing','claims_submission'), ('billing','timely_filing_limit'),
  ('billing','initial_billing_timeline'), ('billing','clean_claim_payment_timeline'), ('billing','cob'),
  ('billing','overpayment'), ('billing','grievances'), ('billing','escalation_path')
);
update field_definitions set source_mode = 'medicaid'
  where section_key = 'staff_coding' and key in ('contracted_codes', 'staff_level_per_code');
update field_definitions set source_mode = 'hold' where section_key = 'clinical_services';

-- Admins may change only source_mode (column-level grant), never labels, keys or anything else.
revoke update on field_definitions from anon, authenticated;
grant update (source_mode) on field_definitions to authenticated;
create policy "Admins can update field source mode" on field_definitions
  for update using (public.is_admin()) with check (public.is_admin());
