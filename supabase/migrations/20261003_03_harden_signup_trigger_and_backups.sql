-- =====================================================================
-- Ramez SIM Manager — security hardening (part 3 of 3)
--
-- Independent of the frontend; apply after part 2 has been verified.
-- No data and no access path changes:
--   1. private_backup: RLS enabled on every backup table (defense in depth).
--      Access stays exactly as it is: the schema has no USAGE for
--      anon/authenticated/service_role, and the owner (postgres) keeps
--      reading because RLS is ENABLED, not FORCED.
--   2. public.handle_new_user() (function of the on_auth_user_created trigger):
--      body and trigger untouched; search_path pinned to '' and EXECUTE
--      removed from PUBLIC/anon/authenticated. supabase_auth_admin (the role
--      that inserts into auth.users on sign-up) keeps EXECUTE explicitly.
--   3. Self-test: a throw-away auth user must still get its employee profile
--      with full_name from metadata, otherwise everything is rolled back.
--
-- All-or-nothing: one transaction. Idempotent. Customer data is never touched.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. private_backup: RLS on every backup table, no grants for API roles
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  if to_regnamespace('private_backup') is null then return; end if;
  revoke all on schema private_backup from public, anon, authenticated, service_role;
  for r in select c.oid::regclass as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'private_backup' and c.relkind in ('r','p') loop
    execute format('alter table %s enable row level security', r.t);
    execute format('revoke all on table %s from public, anon, authenticated, service_role', r.t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. handle_new_user(): same body, same trigger; only privileges + search_path.
--    Every name in the body is schema-qualified (public.profiles), so an
--    empty search_path cannot change what it does (step 3 proves it).
-- ---------------------------------------------------------------------
alter function public.handle_new_user() set search_path = '';
revoke execute on function public.handle_new_user() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Self-test (rolled back): sign-up must still create the profile
-- ---------------------------------------------------------------------
do $$
declare
  u uuid := gen_random_uuid();
  v_role text;
  v_name text;
begin
  if not exists (select 1 from pg_trigger
                 where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'
                   and tgfoid = 'public.handle_new_user()'::regprocedure and tgenabled <> 'D') then
    raise exception 'on_auth_user_created -> public.handle_new_user() missing or disabled — migration aborted';
  end if;
  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values (u, 'migration-selftest-' || u || '@test.invalid', '{"full_name":"selftest"}'::jsonb);
    select role, full_name into v_role, v_name from public.profiles where id = u;
    raise exception 'selftest:%:%', coalesce(v_role, '<none>'), coalesce(v_name, '<none>');
  exception when raise_exception then
    if sqlerrm <> 'selftest:employee:selftest' then
      raise exception 'handle_new_user self-test failed (%) — migration aborted', sqlerrm;
    end if;
  end;
end $$;

-- ---------------------------------------------------------------------
-- 4. Assert the end state (any mismatch rolls everything back)
-- ---------------------------------------------------------------------
do $$ begin
  if has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE') then
    raise exception 'handle_new_user is still executable by anon/authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin')
     and not has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'EXECUTE') then
    raise exception 'supabase_auth_admin lost EXECUTE on handle_new_user';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'private_backup' and c.relkind in ('r','p') and not c.relrowsecurity) then
    raise exception 'a private_backup table still has RLS disabled';
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Rollback (only if needed; restores the previous state, data untouched):
--   alter function public.handle_new_user() set search_path = public;
--   grant execute on function public.handle_new_user() to public, anon, authenticated;
--   revoke execute on function public.handle_new_user() from supabase_auth_admin;
--   -- private_backup RLS can stay enabled (it never limited the owner).
-- ---------------------------------------------------------------------
