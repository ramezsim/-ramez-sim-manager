-- =====================================================================
-- Ramez SIM Manager — security hardening (part 2 of 2)
--
-- Run ONLY AFTER the new frontend is deployed and every old tab/device
-- has been reloaded (or closed). From now on the only way to write the
-- employee state is save_app_state(), which enforces owner = auth.uid()
-- and refuses stale (older-revision) writes.
-- =====================================================================
begin;

revoke insert, update, delete on public.user_app_state from authenticated;
grant select on public.user_app_state to authenticated;
comment on table public.user_app_state is
  'Private state of one employee (owner_id = auth.uid()). rpc-only-writes: all writes go through save_app_state().';

commit;
