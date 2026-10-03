-- =====================================================================
-- Ramez SIM Manager — security hardening (part 2 of 3)
--
-- Run ONLY AFTER the new frontend is deployed and every old tab/device
-- has been reloaded (or closed). From now on the only way to write the
-- employee state is save_app_state(), which enforces owner = auth.uid()
-- and refuses stale (older-revision) writes.
--
-- All-or-nothing: one transaction. Idempotent. Customer data is never touched.
-- =====================================================================
begin;

revoke insert, update, delete on public.user_app_state from authenticated;
grant select on public.user_app_state to authenticated;
comment on table public.user_app_state is
  'Private state of one employee (owner_id = auth.uid()). rpc-only-writes: all writes go through save_app_state().';

-- Assert the end state (any mismatch rolls everything back)
do $$ begin
  if has_table_privilege('authenticated', 'public.user_app_state', 'INSERT,UPDATE,DELETE') then
    raise exception 'authenticated can still write user_app_state directly';
  end if;
  if not has_table_privilege('authenticated', 'public.user_app_state', 'SELECT')
     or not has_function_privilege('authenticated', 'public.save_app_state(jsonb, bigint)', 'EXECUTE') then
    raise exception 'signed-in users lost read access or save_app_state()';
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Rollback (only if needed; restores the part-1 state, data untouched):
--   grant insert, update on public.user_app_state to authenticated;
--   comment on table public.user_app_state is null;
-- ---------------------------------------------------------------------
