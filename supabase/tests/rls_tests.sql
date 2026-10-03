-- =====================================================================
-- RLS / permission tests — User A must never reach User B.
--
-- Safe to run in the Supabase SQL Editor: everything happens inside ONE
-- statement that always ends with an error carrying the report, so every
-- temporary user/row it creates is rolled back automatically.
-- Expected last line of the message:  "RESULT: N passed, 0 failed"
-- =====================================================================
do $test$
declare
  a   uuid := gen_random_uuid();
  b   uuid := gen_random_uuid();
  adm uuid := gen_random_uuid();
  nu  uuid := gen_random_uuid();
  report text := '';
  passed int := 0;
  failed int := 0;
  phase2 boolean := not has_table_privilege('authenticated', 'public.user_app_state', 'UPDATE');
  rev bigint;

  -- run SQL as a role/user and return 'OK:<value>' or 'ERR:<sqlstate>'
  procedure_text text := $f$
    create function rls_tmp.exec_as(p_role text, p_uid uuid, p_sql text) returns text
    language plpgsql as $x$
    declare v text;
    begin
      perform set_config('request.jwt.claims',
        case when p_uid is null then '{"role":"anon"}'
             else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
      execute format('set local role %I', p_role);
      begin
        execute p_sql into v;
        reset role;
        return 'OK:' || coalesce(v, 'null');
      exception when others then
        reset role;
        return 'ERR:' || sqlstate;
      end;
    end $x$;
  $f$;
begin
  create schema rls_tmp;
  execute procedure_text;

  -- fixtures (as the table owner)
  insert into auth.users (id, email) values
    (a,   'rls-a-'   || a   || '@test.invalid'),
    (b,   'rls-b-'   || b   || '@test.invalid'),
    (adm, 'rls-adm-' || adm || '@test.invalid');
  insert into public.profiles (id, email, role) values
    (a, 'a@test.invalid', 'employee'), (b, 'b@test.invalid', 'employee'), (adm, 'adm@test.invalid', 'admin')
  on conflict (id) do update set role = excluded.role;
  insert into public.user_app_state (owner_id, state) values
    (a, '{"owner":"A"}'), (b, '{"owner":"B"}')
  on conflict (owner_id) do update set state = excluded.state;

  -- helper to record a result
  create temporary table _r (n serial, name text, ok boolean, got text);

  -- ---------- anon ----------
  insert into _r(name, ok, got) select 'anon cannot read profiles', v like 'ERR:%', v
    from (select rls_tmp.exec_as('anon', null, 'select count(*)::text from public.profiles') v) s;
  insert into _r(name, ok, got) select 'anon cannot read user_app_state', v like 'ERR:%', v
    from (select rls_tmp.exec_as('anon', null, 'select count(*)::text from public.user_app_state') v) s;
  insert into _r(name, ok, got) select 'anon cannot read companies', v like 'ERR:%', v
    from (select rls_tmp.exec_as('anon', null, 'select count(*)::text from public.companies') v) s;
  if to_regclass('public.app_state') is not null then
    insert into _r(name, ok, got) select 'anon cannot read legacy app_state', v like 'ERR:%', v
      from (select rls_tmp.exec_as('anon', null, 'select count(*)::text from public.app_state') v) s;
  end if;
  insert into _r(name, ok, got) select 'anon cannot call save_app_state', v like 'ERR:%', v
    from (select rls_tmp.exec_as('anon', null, $q$select public.save_app_state('{}'::jsonb, 0)::text$q$) v) s;
  insert into _r(name, ok, got) select 'anon cannot call admin_set_user_role', v like 'ERR:%', v
    from (select rls_tmp.exec_as('anon', null,
      format('select public.admin_set_user_role(%L::uuid, %L)::text', a, 'admin')) v) s;

  -- ---------- user A vs user B : user_app_state ----------
  insert into _r(name, ok, got) select 'A sees exactly one state row (its own)', v = 'OK:1', v
    from (select rls_tmp.exec_as('authenticated', a, 'select count(*)::text from public.user_app_state') v) s;
  insert into _r(name, ok, got) select 'A cannot read B state', v = 'OK:0', v
    from (select rls_tmp.exec_as('authenticated', a,
      format('select count(*)::text from public.user_app_state where owner_id = %L', b)) v) s;
  insert into _r(name, ok, got) select 'A cannot update B state', v in ('OK:0') or v like 'ERR:%', v
    from (select rls_tmp.exec_as('authenticated', a,
      format($q$with x as (update public.user_app_state set state = '{"hacked":true}' where owner_id = %L returning 1) select count(*)::text from x$q$, b)) v) s;
  insert into _r(name, ok, got) select 'A cannot delete B state', v in ('OK:0') or v like 'ERR:%', v
    from (select rls_tmp.exec_as('authenticated', a,
      format('with x as (delete from public.user_app_state where owner_id = %L returning 1) select count(*)::text from x', b)) v) s;
  insert into _r(name, ok, got) select 'A cannot insert a row owned by B', v like 'ERR:%', v
    from (select rls_tmp.exec_as('authenticated', a,
      format($q$with x as (insert into public.user_app_state(owner_id, state) values (%L, '{}') returning 1) select count(*)::text from x$q$, b)) v) s;
  insert into _r(name, ok, got) select 'A cannot move own row to owner_id = B', v like 'ERR:%', v
    from (select rls_tmp.exec_as('authenticated', a,
      format('with x as (update public.user_app_state set owner_id = %L where owner_id = %L returning 1) select count(*)::text from x', b, a)) v) s;
  insert into _r(name, ok, got)
    select case when phase2 then 'direct UPDATE blocked after part 2 (RPC only)' else 'direct UPDATE of own row allowed (part 1 compat)' end,
           case when phase2 then v like 'ERR:%' else v = 'OK:1' end, v
    from (select rls_tmp.exec_as('authenticated', a,
      format($q$with x as (update public.user_app_state set state = '{"owner":"A","n":1}' where owner_id = %L returning 1) select count(*)::text from x$q$, a)) v) s;

  -- ---------- save_app_state (conflict detection) ----------
  begin
    execute format('select revision from public.user_app_state where owner_id = %L', a) into rev;
  exception when undefined_column then
    rev := 1;   -- migration not applied yet
  end;
  insert into _r(name, ok, got) select 'stale save (old revision) is rejected as conflict', v like '%"conflict"%', v
    from (select rls_tmp.exec_as('authenticated', a,
      format($q$select public.save_app_state('{"owner":"A","stale":true}'::jsonb, %s)::text$q$, rev - 1)) v) s;
  insert into _r(name, ok, got) select 'save based on latest revision succeeds', v like '%"ok"%' and v like '%"revision": ' || (rev + 1) || '%', v
    from (select rls_tmp.exec_as('authenticated', a,
      format($q$select public.save_app_state('{"owner":"A","n":2}'::jsonb, %s)::text$q$, rev)) v) s;
  insert into _r(name, ok, got) select 'second device with the same old base gets conflict', v like '%"conflict"%', v
    from (select rls_tmp.exec_as('authenticated', a,
      format($q$select public.save_app_state('{"owner":"A","device":2}'::jsonb, %s)::text$q$, rev)) v) s;
  insert into _r(name, ok, got) select 'A saves never touch B state', v = 'OK:B', v
    from (select 'OK:' || coalesce((select state ->> 'owner' from public.user_app_state where owner_id = b), 'missing') v) s;
  insert into _r(name, ok, got) select 'stale write did not overwrite newer data', v = 'OK:2', v
    from (select 'OK:' || coalesce((select state ->> 'n' from public.user_app_state where owner_id = a), 'missing') v) s;

  -- ---------- profiles / roles ----------
  insert into _r(name, ok, got) select 'A sees only its own profile', v = 'OK:1', v
    from (select rls_tmp.exec_as('authenticated', a,
      format('select count(*)::text from public.profiles where id in (%L, %L, %L)', a, b, adm)) v) s;
  insert into _r(name, ok, got) select 'A cannot change its own role', v like 'ERR:%' or v = 'OK:0', v
    from (select rls_tmp.exec_as('authenticated', a,
      format($q$with x as (update public.profiles set role = 'admin' where id = %L returning 1) select count(*)::text from x$q$, a)) v) s;
  insert into _r(name, ok, got) select 'A cannot insert profiles', v like 'ERR:%', v
    from (select rls_tmp.exec_as('authenticated', a,
      format($q$with x as (insert into public.profiles(id, role) values (%L, 'admin') returning 1) select count(*)::text from x$q$, gen_random_uuid())) v) s;
  insert into _r(name, ok, got) select 'A cannot self-promote via admin_set_user_role', v like 'ERR:%', v
    from (select rls_tmp.exec_as('authenticated', a,
      format('select public.admin_set_user_role(%L::uuid, %L)::text', a, 'admin')) v) s;
  insert into _r(name, ok, got) select 'A is still employee', v = 'OK:employee', v
    from (select 'OK:' || role v from public.profiles where id = a) s;
  insert into _r(name, ok, got) select 'admin can list profiles', v = 'OK:3', v
    from (select rls_tmp.exec_as('authenticated', adm,
      format('select count(*)::text from public.profiles where id in (%L, %L, %L)', a, b, adm)) v) s;
  insert into _r(name, ok, got) select 'admin cannot read employee state', v = 'OK:0', v
    from (select rls_tmp.exec_as('authenticated', adm,
      format('select count(*)::text from public.user_app_state where owner_id in (%L, %L)', a, b)) v) s;
  insert into _r(name, ok, got) select 'admin can set a valid role', v like 'OK:%', v
    from (select rls_tmp.exec_as('authenticated', adm,
      format('select coalesce(public.admin_set_user_role(%L::uuid, %L)::text, %L)', b, 'manager', 'done')) v) s;
  insert into _r(name, ok, got) select 'invalid role value rejected', v like 'ERR:%', v
    from (select rls_tmp.exec_as('authenticated', adm,
      format('select public.admin_set_user_role(%L::uuid, %L)::text', b, 'superuser')) v) s;

  -- ---------- companies ----------
  insert into _r(name, ok, got) select 'employee can read companies', v like 'OK:%', v
    from (select rls_tmp.exec_as('authenticated', a, 'select count(*)::text from public.companies') v) s;
  insert into _r(name, ok, got) select 'employee cannot add companies', v like 'ERR:%', v
    from (select rls_tmp.exec_as('authenticated', a,
      $q$with x as (insert into public.companies(id, name, wholesale_price, logo) values (990000000001, 'x', 1, '') returning 1) select count(*)::text from x$q$) v) s;
  insert into _r(name, ok, got) select 'employee cannot edit companies', v = 'OK:0' or v like 'ERR:%', v
    from (select rls_tmp.exec_as('authenticated', a,
      $q$with x as (update public.companies set name = 'hacked' returning 1) select count(*)::text from x$q$) v) s;
  insert into _r(name, ok, got) select 'admin can add a company', v = 'OK:1', v
    from (select rls_tmp.exec_as('authenticated', adm,
      $q$with x as (insert into public.companies(id, name, wholesale_price, logo) values (990000000002, 'test co', 1, 'data:image/png;base64,iVBORw0KGgo=') returning 1) select count(*)::text from x$q$) v) s;
  insert into _r(name, ok, got) select 'script-like logo rejected', v like 'ERR:23514', v
    from (select rls_tmp.exec_as('authenticated', adm,
      $q$with x as (insert into public.companies(id, name, wholesale_price, logo) values (990000000003, 'evil', 1, 'x" onerror="alert(1)') returning 1) select count(*)::text from x$q$) v) s;

  -- ---------- legacy / private ----------
  if to_regclass('public.app_state') is not null then
    insert into _r(name, ok, got) select 'signed-in user cannot read legacy app_state', v like 'ERR:%', v
      from (select rls_tmp.exec_as('authenticated', a, 'select count(*)::text from public.app_state') v) s;
  end if;
  if to_regclass('private_backup.user_app_state_20261003') is not null then
    insert into _r(name, ok, got) select 'signed-in user cannot read backups', v like 'ERR:%', v
      from (select rls_tmp.exec_as('authenticated', a, 'select count(*)::text from private_backup.user_app_state_20261003') v) s;
  end if;

  -- ---------- new accounts ----------
  insert into auth.users (id, email) values (nu, 'rls-new-' || nu || '@test.invalid');
  insert into _r(name, ok, got) select 'new account gets an employee profile', v = 'OK:employee', v
    from (select 'OK:' || coalesce((select role from public.profiles where id = nu), 'missing') v) s;

  select count(*) filter (where ok), count(*) filter (where not ok) into passed, failed from _r;
  select string_agg(case when ok then 'PASS  ' else 'FAIL  ' end || name || '   [' || got || ']', E'\n' order by n)
    into report from _r;
  raise exception E'RLS TEST REPORT (all changes rolled back)\n%\nRESULT: % passed, % failed', report, passed, failed;
end
$test$;
