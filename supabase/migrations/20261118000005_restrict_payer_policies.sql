-- Replace the permissive local-dev policies on payers, payer_values and audit_log.
--   * Reading requires a signed-in user.
--   * Writing requires a manager or admin (public.is_reviewer()).
-- Viewers can still browse everything but can no longer change data.

-- payers
drop policy if exists "allow_all_payers" on payers;
create policy "payers_select" on payers for select to authenticated using (true);
create policy "payers_insert" on payers for insert to authenticated with check (public.is_reviewer());
create policy "payers_update" on payers for update to authenticated
  using (public.is_reviewer()) with check (public.is_reviewer());
create policy "payers_delete" on payers for delete to authenticated using (public.is_reviewer());

-- payer_values
drop policy if exists "allow_all_payer_values" on payer_values;
create policy "payer_values_select" on payer_values for select to authenticated using (true);
create policy "payer_values_insert" on payer_values for insert to authenticated with check (public.is_reviewer());
create policy "payer_values_update" on payer_values for update to authenticated
  using (public.is_reviewer()) with check (public.is_reviewer());
create policy "payer_values_delete" on payer_values for delete to authenticated using (public.is_reviewer());

-- audit_log
drop policy if exists "Allow read audit_log for all" on audit_log;
drop policy if exists "Allow insert audit_log for authenticated" on audit_log;
create policy "audit_log_select" on audit_log for select to authenticated using (true);
create policy "audit_log_insert" on audit_log for insert to authenticated with check (public.is_reviewer());
