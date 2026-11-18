-- Web-app research: one task per (payer, field), run in the background by the app.
-- research_runs (existing) is the batch; research_tasks are its units of work.

alter table findings
  add column quote_verified    boolean,   -- true = the server found the quote in the downloaded source
  add column verification_note text;      -- why a quote could not be verified, or how it was matched

create table research_tasks (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references research_runs(id) on delete cascade,
  payer_id      uuid not null references payers(id) on delete cascade,
  field_id      uuid not null references field_definitions(id) on delete cascade,
  status        text not null default 'queued'
                  check (status in ('queued','running','done','failed','cancelled')),
  attempts      int  not null default 0,
  started_at    timestamptz,
  finished_at   timestamptz,
  summary       text,                     -- e.g. "1 finding" / "Not found"
  error         text,
  input_tokens  int,
  output_tokens int,
  web_searches  int,
  created_at    timestamptz not null default now(),
  unique (run_id, field_id)
);
create index research_tasks_status_idx on research_tasks (status, created_at);
create index research_tasks_run_idx    on research_tasks (run_id);

alter table research_tasks enable row level security;
create policy "read research_tasks" on research_tasks for select to authenticated using (true);
create policy "reviewers write research_tasks" on research_tasks for all to authenticated
  using (public.is_reviewer()) with check (public.is_reviewer());
