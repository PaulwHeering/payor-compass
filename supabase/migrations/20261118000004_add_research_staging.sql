-- Research staging layer.
-- Claude proposes values into `findings` (with source + quote). A human reviewer approves them,
-- and only then are they copied into `payer_values` (via publish_finding) with an audit_log entry.

-- ---------- helper: can this user review/publish? ----------
create or replace function public.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role in ('manager','admin')
  );
$$;

-- ---------- research_runs: one row per "research this payer" request ----------
create table research_runs (
  id            uuid primary key default gen_random_uuid(),
  payer_id      uuid not null references payers(id) on delete cascade,
  kind          text not null default 'research' check (kind in ('research','recheck')),
  requested_by  text not null,                 -- email of the person who asked
  notes         text,                          -- e.g. "fields: prior auth, timely filing"
  status        text not null default 'open' check (status in ('open','complete','cancelled')),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index research_runs_payer_idx on research_runs (payer_id, created_at desc);

-- ---------- findings: proposed values awaiting review ----------
create table findings (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid references research_runs(id) on delete set null,
  payer_id            uuid not null references payers(id) on delete cascade,
  field_id            uuid not null references field_definitions(id) on delete restrict,
  proposed_value      text,                    -- null allowed only for status 'not_found'
  position            int  not null default 0, -- for repeatable fields
  source_url          text,
  source_quote        text,                    -- exact text from the source that supports the value
  source_type         text check (source_type in
                        ('provider_manual','clinical_policy','payer_website','contract','state_filing','other')),
  retrieved_at        timestamptz not null default now(),
  confidence          text not null default 'medium' check (confidence in ('high','medium','low')),
  status              text not null default 'pending'
                        check (status in ('pending','approved','rejected','needs_info','not_found','superseded')),
  -- set when this finding proposes a change to a value already published
  replaces_value_id   uuid references payer_values(id) on delete set null,
  -- set once published
  published_value_id  uuid references payer_values(id) on delete set null,
  reviewer_email      text,
  reviewed_at         timestamptz,
  reviewer_notes      text,                    -- rejection reasons feed back into the playbooks
  created_at          timestamptz not null default now(),
  -- "No source and quote, no finding" (except an explicit not-found result)
  constraint findings_requires_source check (
    status = 'not_found'
    or (proposed_value is not null and source_url is not null and source_quote is not null)
  )
);
create index findings_review_queue_idx on findings (status, created_at);
create index findings_payer_field_idx  on findings (payer_id, field_id);

-- ---------- field_playbooks: Claude's "memory" of how a field was found ----------
-- payer_id null  = general guidance for the field (applies to every payer)
-- payer_id set   = payer-specific notes (e.g. "Aetna keeps this in provider manual section 4")
create table field_playbooks (
  id                   uuid primary key default gen_random_uuid(),
  field_id             uuid not null references field_definitions(id) on delete cascade,
  payer_id             uuid references payers(id) on delete cascade,
  where_to_look        text,    -- document types / page types that usually hold the answer
  how_found            text,    -- how it was found last time (path, document, section)
  search_terms         text[],
  authoritative_sources text,   -- which sources to trust, which to avoid
  gotchas              text,    -- pitfalls, incl. lessons from rejected findings
  updated_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index field_playbooks_unique_idx
  on field_playbooks (field_id, coalesce(payer_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------- source_snapshots: used by the daily change check ----------
create table source_snapshots (
  id             uuid primary key default gen_random_uuid(),
  finding_id     uuid references findings(id) on delete cascade,
  url            text not null,
  fetched_at     timestamptz not null default now(),
  http_status    int,
  content_hash   text,           -- hash of the fetched content; a change triggers a recheck
  extracted_text text
);
create index source_snapshots_url_idx on source_snapshots (url, fetched_at desc);

-- ---------- publish_finding: the ONLY path from staging to payer_values ----------
create or replace function public.publish_finding(p_finding_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  f            findings%rowtype;
  v_repeatable boolean;
  v_reviewer   text;
  v_existing   payer_values%rowtype;
  v_value_id   uuid;
begin
  if not public.is_reviewer() then
    raise exception 'Only managers and admins can approve findings';
  end if;

  select * into f from findings where id = p_finding_id for update;
  if not found then raise exception 'Finding not found'; end if;
  if f.status <> 'pending' then raise exception 'Finding is not pending (status: %)', f.status; end if;
  if f.proposed_value is null then raise exception 'Finding has no value to publish'; end if;

  select email into v_reviewer from user_profiles where id = auth.uid();
  select repeatable into v_repeatable from field_definitions where id = f.field_id;

  if f.replaces_value_id is not null then
    select * into v_existing from payer_values where id = f.replaces_value_id;
  elsif not v_repeatable then
    select * into v_existing from payer_values where payer_id = f.payer_id and field_id = f.field_id limit 1;
  end if;

  if v_existing.id is not null then
    update payer_values set value = f.proposed_value, updated_at = now() where id = v_existing.id;
    v_value_id := v_existing.id;
    insert into audit_log (payer_id, field_id, old_value, new_value, changed_by, change_type)
      values (f.payer_id, f.field_id, v_existing.value, f.proposed_value, coalesce(v_reviewer,'unknown'), 'update');
  else
    insert into payer_values (payer_id, field_id, value, position)
      values (f.payer_id, f.field_id, f.proposed_value, f.position)
      returning id into v_value_id;
    insert into audit_log (payer_id, field_id, old_value, new_value, changed_by, change_type)
      values (f.payer_id, f.field_id, null, f.proposed_value, coalesce(v_reviewer,'unknown'), 'create');
  end if;

  update findings
     set status = 'approved', published_value_id = v_value_id,
         reviewer_email = v_reviewer, reviewed_at = now(),
         reviewer_notes = coalesce(p_notes, reviewer_notes)
   where id = f.id;

  return v_value_id;
end;
$$;

-- ---------- RLS ----------
alter table research_runs    enable row level security;
alter table findings         enable row level security;
alter table field_playbooks  enable row level security;
alter table source_snapshots enable row level security;

-- Signed-in users can read everything in the research layer.
create policy "read research_runs"    on research_runs    for select to authenticated using (true);
create policy "read findings"         on findings         for select to authenticated using (true);
create policy "read field_playbooks"  on field_playbooks  for select to authenticated using (true);
create policy "read source_snapshots" on source_snapshots for select to authenticated using (true);

-- Reviewers (manager/admin) can create and update staging rows, including approve/reject.
-- Approval that publishes a value must go through publish_finding().
create policy "reviewers write research_runs"    on research_runs    for all to authenticated
  using (public.is_reviewer()) with check (public.is_reviewer());
create policy "reviewers write findings"         on findings         for all to authenticated
  using (public.is_reviewer()) with check (public.is_reviewer());
create policy "reviewers write field_playbooks"  on field_playbooks  for all to authenticated
  using (public.is_reviewer()) with check (public.is_reviewer());
create policy "reviewers write source_snapshots" on source_snapshots for all to authenticated
  using (public.is_reviewer()) with check (public.is_reviewer());

grant execute on function public.publish_finding(uuid, text) to authenticated;
revoke execute on function public.publish_finding(uuid, text) from anon, public;
