-- Uploaded PDF files per payer (contracts, fee schedules, etc.), used to fill in the fields whose
-- source_mode is 'file' ("From uploaded files"). The PDFs live in the private storage bucket
-- 'payer-files' at <payer_id>/<uuid>.pdf; this table lists them.
--   * Any signed-in user can see and preview the files.
--   * Only managers and admins (public.is_reviewer()) can upload or delete them.

-- ---------- storage bucket (private, PDF only, 50 MB max) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payer-files', 'payer-files', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "payer_files_objects_select" on storage.objects for select to authenticated
  using (bucket_id = 'payer-files');
create policy "payer_files_objects_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'payer-files' and public.is_reviewer());
create policy "payer_files_objects_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'payer-files' and public.is_reviewer());

-- ---------- payer_files: one row per uploaded file ----------
create table payer_files (
  id           uuid primary key default gen_random_uuid(),
  payer_id     uuid not null references payers(id) on delete cascade,
  storage_path text not null unique,           -- path inside the 'payer-files' bucket
  file_name    text not null,                  -- original name shown in the app
  description  text,                           -- optional, e.g. "2026 commercial contract"
  size_bytes   bigint,
  uploaded_by  uuid default auth.uid() references auth.users(id) on delete set null,
  uploaded_by_email text,
  created_at   timestamptz not null default now()
);
create index payer_files_payer_idx on payer_files (payer_id, created_at desc);

alter table payer_files enable row level security;
create policy "payer_files_select" on payer_files for select to authenticated using (true);
create policy "payer_files_insert" on payer_files for insert to authenticated
  with check (public.is_reviewer() and uploaded_by = auth.uid());
create policy "payer_files_delete" on payer_files for delete to authenticated using (public.is_reviewer());
