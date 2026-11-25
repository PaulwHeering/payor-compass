-- Change history recorded by the database itself.
--
-- Before: the payer form wrote audit_log rows from the browser. Every edit was credited to one hard-coded
-- email, cleared values and deleted payers were never recorded, a failed log write was ignored, and anyone
-- with write access could change data through the API without leaving a trace.
--
-- Now: triggers on every table people edit write audit_log for each insert, update and delete, credited to
-- the signed-in account (auth.uid()). Nobody can write, edit or delete audit_log directly. History survives
-- when a payer is deleted (payer_name is kept on each row).

-- ---------- audit_log: room for every table, history kept after a payer is deleted ----------
alter table audit_log drop constraint if exists audit_log_payer_id_fkey;
alter table audit_log alter column payer_id drop not null;
alter table audit_log
  add column if not exists payer_name    text,                 -- payer's name at the time (kept after deletion)
  add column if not exists table_name    text not null default 'payer_values',
  add column if not exists record_id     uuid,                 -- id of the changed row
  add column if not exists column_name   text,                 -- which column changed (null = the whole row)
  add column if not exists item          text,                 -- what changed, in words: field label, "Payer", "Job title"...
  add column if not exists note          text,                 -- e.g. "Approved finding"
  add column if not exists changed_by_id uuid;                 -- auth user id (null for system / database admin)
-- The real time of each change (now() is the same for a whole transaction, which loses the order).
alter table audit_log alter column changed_at set default clock_timestamp();
create index if not exists idx_audit_log_table      on audit_log (table_name, changed_at desc);
create index if not exists idx_audit_log_changed_by on audit_log (changed_by);

-- Only the triggers below write history; nobody can add, edit or delete it.
drop policy if exists "audit_log_insert" on audit_log;
revoke insert, update, delete, truncate on audit_log from anon, authenticated;

-- Changes to people and roles are visible to admins only (the Users page is admin-only too).
drop policy if exists "audit_log_select" on audit_log;
create policy "audit_log_select" on audit_log for select to authenticated
  using (table_name not in ('user_profiles', 'job_titles') or public.is_admin());

-- ---------- helpers ----------
-- Who is making the change: the signed-in person's email, else "system" for the server's own key
-- (e.g. saving a profile at sign-in), else the database user (migrations, SQL editor).
create or replace function public.audit_actor_email()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select email from public.user_profiles where id = auth.uid()),
    nullif(auth.jwt() ->> 'email', ''),
    case when auth.role() = 'service_role' then 'system' else 'database admin (' || session_user || ')' end
  );
$$;

-- A payer's name, also after the payer row is gone (taken from its history).
create or replace function public.audit_payer_name(p_payer_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select name from public.payers where id = p_payer_id),
    (select payer_name from public.audit_log
      where payer_id = p_payer_id and payer_name is not null order by changed_at desc limit 1)
  );
$$;

-- Optional note for the current transaction, set with set_config('app.audit_note', '...', true).
create or replace function public.audit_note()
returns text language sql stable as $$
  select nullif(current_setting('app.audit_note', true), '');
$$;

-- ---------- payers ----------
create or replace function public.audit_payers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (payer_id, payer_name, table_name, record_id, column_name, item, old_value, new_value,
                           changed_by, changed_by_id, change_type, note)
    values (new.id, new.name, 'payers', new.id, 'name', 'Payer', null, new.name,
            audit_actor_email(), auth.uid(), 'create', audit_note());
    return new;
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name then
      insert into audit_log (payer_id, payer_name, table_name, record_id, column_name, item, old_value, new_value,
                             changed_by, changed_by_id, change_type, note)
      values (new.id, new.name, 'payers', new.id, 'name', 'Payer name', old.name, new.name,
              audit_actor_email(), auth.uid(), 'update', audit_note());
    end if;
    return new;
  else
    insert into audit_log (payer_id, payer_name, table_name, record_id, column_name, item, old_value, new_value,
                           changed_by, changed_by_id, change_type, note)
    values (old.id, old.name, 'payers', old.id, 'name', 'Payer', old.name, null,
            audit_actor_email(), auth.uid(), 'delete', audit_note());
    return old;
  end if;
end;
$$;

drop trigger if exists audit_payers_write on payers;
create trigger audit_payers_write after insert or update on payers
  for each row execute function public.audit_payers();
-- BEFORE delete, so the payer is logged before its values are removed with it.
drop trigger if exists audit_payers_delete on payers;
create trigger audit_payers_delete before delete on payers
  for each row execute function public.audit_payers();

-- ---------- payer_values (the live, approved data) ----------
create or replace function public.audit_payer_values()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r       payer_values%rowtype;
  v_label text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  -- Reordering a list (position) or bumping updated_at is not a change of data.
  if tg_op = 'UPDATE' and new.value is not distinct from old.value then return new; end if;
  select label into v_label from field_definitions where id = r.field_id;

  insert into audit_log (payer_id, payer_name, field_id, table_name, record_id, column_name, item,
                         old_value, new_value, changed_by, changed_by_id, change_type, note)
  values (r.payer_id, audit_payer_name(r.payer_id), r.field_id, 'payer_values', r.id, 'value', v_label,
          case when tg_op = 'INSERT' then null else old.value end,
          case when tg_op = 'DELETE' then null else new.value end,
          audit_actor_email(), auth.uid(),
          case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
          audit_note());
  return r;
end;
$$;

drop trigger if exists audit_payer_values on payer_values;
create trigger audit_payer_values after insert or update or delete on payer_values
  for each row execute function public.audit_payer_values();

-- ---------- every other table people edit ----------
-- Arguments: 1) what the row is, in words ("Job title"); 2) column holding the row's name, or '' to log each
-- filled-in column on create/delete; 3...) columns to track (none = every column except ids and timestamps).
-- Updates log one row per changed column.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o       jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n       jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r       jsonb := coalesce(n, o);
  v_item  text  := tg_argv[0];
  v_name  text  := nullif(tg_argv[1], '');
  tracked text[] := coalesce(tg_argv[2:], '{}');
  skip    text[] := array['id', 'created_at', 'updated_at', 'updated_by', 'payer_id', 'field_id'];
  v_payer uuid  := (r ->> 'payer_id')::uuid;
  v_field uuid  := case when tg_table_name = 'field_definitions' then (r ->> 'id')::uuid
                        else (r ->> 'field_id')::uuid end;
  v_type  text  := case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;
  v_pname text  := case when v_payer is not null then audit_payer_name(v_payer) end;
  k       text;
begin
  if tg_op = 'UPDATE' or v_name is null then
    for k in select jsonb_object_keys(r) loop
      continue when k = any(skip);
      continue when cardinality(tracked) > 0 and not k = any(tracked);
      continue when tg_op = 'UPDATE' and (o -> k) is not distinct from (n -> k);
      continue when tg_op <> 'UPDATE' and jsonb_typeof(r -> k) = 'null';
      insert into audit_log (payer_id, payer_name, field_id, table_name, record_id, column_name, item,
                             old_value, new_value, changed_by, changed_by_id, change_type, note)
      values (v_payer, v_pname, v_field, tg_table_name, (r ->> 'id')::uuid, k, v_item,
              o ->> k, n ->> k, audit_actor_email(), auth.uid(), v_type, audit_note());
    end loop;
  else
    insert into audit_log (payer_id, payer_name, field_id, table_name, record_id, column_name, item,
                           old_value, new_value, changed_by, changed_by_id, change_type, note)
    values (v_payer, v_pname, v_field, tg_table_name, (r ->> 'id')::uuid, null, v_item,
            o ->> v_name, n ->> v_name, audit_actor_email(), auth.uid(), v_type, audit_note());
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_payer_files on payer_files;
create trigger audit_payer_files after insert or update or delete on payer_files
  for each row execute function public.audit_row('Uploaded file', 'file_name', 'file_name', 'description');

drop trigger if exists audit_field_definitions on field_definitions;
create trigger audit_field_definitions after insert or update or delete on field_definitions
  for each row execute function public.audit_row('Field', 'label');

drop trigger if exists audit_sections on sections;
create trigger audit_sections after insert or update or delete on sections
  for each row execute function public.audit_row('Section', 'label');

drop trigger if exists audit_job_titles on job_titles;
create trigger audit_job_titles after insert or update or delete on job_titles
  for each row execute function public.audit_row('Job title', 'title', 'title', 'role', 'enabled');

drop trigger if exists audit_user_profiles on user_profiles;
create trigger audit_user_profiles after insert or update or delete on user_profiles
  for each row execute function public.audit_row('User', 'email', 'email', 'job_title', 'role');

drop trigger if exists audit_field_playbooks on field_playbooks;
create trigger audit_field_playbooks after insert or update or delete on field_playbooks
  for each row execute function public.audit_row('Playbook', '');

-- Findings: only review decisions and reviewer edits (not every research result as it arrives).
drop trigger if exists audit_findings on findings;
create trigger audit_findings after update on findings
  for each row execute function public.audit_row('Finding', '', 'status', 'proposed_value');

-- ---------- publish_finding: the payer_values trigger now writes the history ----------
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

  perform set_config('app.audit_note', 'Approved finding', true);
  if v_existing.id is not null then
    update payer_values set value = f.proposed_value, updated_at = now() where id = v_existing.id;
    v_value_id := v_existing.id;
  else
    insert into payer_values (payer_id, field_id, value, position)
      values (f.payer_id, f.field_id, f.proposed_value, f.position)
      returning id into v_value_id;
  end if;

  update findings
     set status = 'approved', published_value_id = v_value_id,
         reviewer_email = v_reviewer, reviewed_at = now(),
         reviewer_notes = coalesce(p_notes, reviewer_notes)
   where id = f.id;
  perform set_config('app.audit_note', '', true);

  return v_value_id;
end;
$$;

-- Trigger functions run only as triggers.
revoke execute on function public.audit_payers(), public.audit_payer_values(), public.audit_row()
  from anon, authenticated, public;
