-- Payor Compass: payers + one-row-per-value design (no wide flat tables)

create table sections (
  key       text primary key,
  label     text not null,
  position  int  not null
);

-- Describes every field that can be captured. The UI is generated from this table,
-- so adding a new field to the app = inserting a row here.
create table field_definitions (
  id          uuid primary key default gen_random_uuid(),
  section_key text not null references sections(key) on delete cascade,
  key         text not null,
  label       text not null,
  input_type  text not null default 'text' check (input_type in ('text','longtext','date','url')),
  repeatable  boolean not null default false,  -- true = many value rows allowed (e.g. states, codes)
  help        text,
  position    int  not null,
  unique (section_key, key)
);

create table payers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per value. A repeatable field simply has several rows (ordered by position).
create table payer_values (
  id         uuid primary key default gen_random_uuid(),
  payer_id   uuid not null references payers(id) on delete cascade,
  field_id   uuid not null references field_definitions(id) on delete restrict,
  value      text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payer_values_payer_idx on payer_values (payer_id, field_id, position);

-- RLS policies for local dev (permissive). Entra login + user-based policies come later.
alter table sections          enable row level security;
alter table field_definitions enable row level security;
alter table payers            enable row level security;
alter table payer_values      enable row level security;

-- Allow everyone to read sections & fields (metadata)
create policy "allow_read_sections" on sections for select using (true);
create policy "allow_read_field_definitions" on field_definitions for select using (true);

-- Allow everyone to read/write payers and values (local dev; production gets Entra policies)
create policy "allow_all_payers" on payers for all using (true);
create policy "allow_all_payer_values" on payer_values for all using (true);

-- ---------- seed: sections ----------
insert into sections (key, label, position) values
  ('profile','Profile',1),
  ('links','Links',2),
  ('staff_coding','Staff & Coding',3),
  ('authorizations','Authorizations',4),
  ('clinical_services','Clinical Services',5),
  ('credentialing','Credentialing',6),
  ('billing','Billing',7);

-- ---------- seed: fields ----------
-- (section, key, label, input_type, repeatable, position)
insert into field_definitions (section_key, key, label, input_type, repeatable, position) values
  -- 1 Profile
  ('profile','tin','TIN','text',false,1),
  ('profile','payer_names','Payer name(s) / AKAs','text',true,2),
  ('profile','states_covered','States covered','text',true,3),
  ('profile','contract_effective_date','Contract effective date','date',false,4),
  ('profile','renewal_terms','Renewal terms','longtext',false,5),
  ('profile','termination_terms','Termination terms','longtext',false,6),
  ('profile','contacts_link','Link to contacts (restricted access)','url',false,7),
  -- 2 Links
  ('links','provider_portal','Provider portal','url',false,1),
  ('links','provider_manual','Provider manual','url',false,2),
  ('links','clinical_policy','Clinical policy','url',false,3),
  ('links','billing_manual','Billing manual','url',false,4),
  -- 3 Staff & Coding
  ('staff_coding','contracted_codes','Contracted codes','text',true,1),
  ('staff_coding','staff_level_per_code','Staff level allowed per code','text',true,2),
  ('staff_coding','supervision_billing_rules','Supervision billing rules','longtext',false,3),
  ('staff_coding','required_modifiers','Required modifiers','text',true,4),
  ('staff_coding','cap_daily','Service hour cap — daily','text',false,5),
  ('staff_coding','cap_weekly','Service hour cap — weekly','text',false,6),
  ('staff_coding','cap_monthly','Service hour cap — monthly','text',false,7),
  ('staff_coding','cap_auth_duration','Service hour cap — authorization duration','text',false,8),
  ('staff_coding','telehealth_allowance','Telehealth allowance','text',false,9),
  ('staff_coding','telehealth_requirements','Telehealth requirements','longtext',false,10),
  -- 4 Authorizations
  ('authorizations','forms','Forms (linked)','url',true,1),
  ('authorizations','submission_process','Request / submission process','longtext',false,2),
  ('authorizations','required_diagnoses','Required diagnoses','text',true,3),
  ('authorizations','restricted_diagnoses','Restricted diagnoses','text',true,4),
  ('authorizations','supporting_documentation','Required supporting documentation','text',true,5),
  ('authorizations','submission_timelines','Submission timelines','text',false,6),
  ('authorizations','turnaround_timelines','Turnaround timelines','text',false,7),
  ('authorizations','peer_to_peer','Peer-to-peer process','longtext',false,8),
  ('authorizations','medical_necessity','Medical necessity requirements','longtext',false,9),
  ('authorizations','appeals','Appeals','longtext',false,10),
  ('authorizations','grievances','Grievances / complaints','longtext',false,11),
  -- 5 Clinical Services
  ('clinical_services','clinical_policy_details','Key details from Clinical Policy','longtext',true,1),
  -- 6 Credentialing
  ('credentialing','levels_requiring_credentialing','Provider levels requiring direct credentialing','text',true,1),
  ('credentialing','contracting_model','Individual vs. company-NPI contracting','text',false,2),
  ('credentialing','process_turnaround','Credentialing process & turnaround time','longtext',false,3),
  ('credentialing','revalidation','Revalidation / re-attestation timelines','longtext',false,4),
  ('credentialing','staff_termination','Staff termination process','longtext',false,5),
  ('credentialing','training_background_monitoring','Ongoing training, background check & monitoring requirements','longtext',false,6),
  ('credentialing','education_requirements','Education requirements (uncertified staff / rate tiers)','longtext',false,7),
  ('credentialing','escalation_path','Escalation path','longtext',false,8),
  -- 7 Billing
  ('billing','eft','EFT','text',false,1),
  ('billing','claim_form','Claim form requirements','text',false,2),
  ('billing','waystar_id','Waystar ID','text',false,3),
  ('billing','claims_address','Claims address','longtext',false,4),
  ('billing','fee_schedule_status','Fee schedule status (contract / State MCD, etc.)','text',false,5),
  ('billing','fee_schedule_link','Fee schedule link (restricted access)','url',false,6),
  ('billing','claims_submission','Claims submission process','longtext',false,7),
  ('billing','timely_filing_limit','Timely filing limit','text',false,8),
  ('billing','initial_billing_timeline','Initial billing timeline','text',false,9),
  ('billing','clean_claim_payment_timeline','Clean-claim payment timeline','text',false,10),
  ('billing','cob','Coordination of Benefits (COB)','longtext',false,11),
  ('billing','overpayment','Overpayment / recoupment process','longtext',false,12),
  ('billing','grievances','Grievances / complaints process','longtext',false,13),
  ('billing','escalation_path','Escalation path','longtext',false,14);
