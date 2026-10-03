-- =====================================================================
-- Ramez SIM Manager — security hardening (part 1 of 2)
--
-- Safe to run while the OLD frontend is still live: it keeps direct
-- writes to user_app_state working (now strictly owner-only) and adds the
-- revision/RPC used by the new frontend.
--
-- What it does
--   0. Private backup copies of profiles / user_app_state / companies / app_state.
--   1. RLS on every table in "public"; anon gets no table access at all.
--   2. profiles      : read own row (admins read all); NO client writes;
--                      role changes only through admin_set_user_role().
--   3. user_app_state: strictly auth.uid() = owner_id for select/insert/update
--                      (no DELETE privilege), owner_id immutable, revision column +
--                      save_app_state() RPC with optimistic-concurrency (conflicts).
--   4. companies     : shared catalogue, read by signed-in users, written by admins only,
--                      logo must be a base64 raster data URL.
--   5. app_state     : legacy single-row shared state -> locked (data kept).
--   6. Functions     : anon cannot execute SECURITY DEFINER functions in public;
--                      every old admin_set_user_role() is replaced by a hardened one.
--   Side effect: functions created later in "public" are not executable by
--   anon/authenticated until you GRANT EXECUTE explicitly (secure default).
--
-- All-or-nothing: wrapped in one transaction; any error rolls back everything.
-- Idempotent: running it twice is harmless. Customer data is never deleted.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Backups (schema not exposed through the Data API)
-- ---------------------------------------------------------------------
create schema if not exists private_backup;
revoke all on schema private_backup from public;
do $$
declare t text;
begin
  if to_regclass('auth.users') is null then
    raise exception 'auth.users not found — run this in the Supabase project database';
  end if;
  foreach t in array array['profiles','user_app_state','companies','app_state'] loop
    if to_regclass('public.'||t) is not null
       and to_regclass('private_backup.'||t||'_20261003') is null then
      execute format('create table private_backup.%I as table public.%I', t||'_20261003', t);
      raise notice 'backup created: private_backup.%_20261003', t;
    end if;
  end loop;
end $$;
revoke all on all tables in schema private_backup from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Helper schema for security-definer helpers (not exposed through the API)
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. RLS everywhere + no anon table access
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- Drop every existing policy on the tables we manage so the end state is
-- exactly what is defined below (unknown old permissive policies disappear).
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('profiles','user_app_state','companies','app_state') loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'employee',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles alter column role set default 'employee';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check'
                 and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_role_check
      check (role in ('employee','manager','admin')) not valid;
  end if;
end $$;
alter table public.profiles enable row level security;

-- Admin check used by policies (security definer: avoids RLS recursion).
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated, service_role;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;           -- no insert/update/delete from clients

create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

-- Profile row for every new auth user (never blocks sign-in if it fails).
create or replace function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.profiles (id, email, role)
    values (new.id, new.email, 'employee')
    on conflict (id) do nothing;
  exception when others then
    raise warning 'profile creation skipped for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.handle_new_user_profile() from public;
-- Only add our trigger when the project has no profile-creating trigger yet
-- (production already has on_auth_user_created -> public.handle_new_user()).
do $$ begin
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass
                 and not t.tgisinternal and t.tgname <> 'on_auth_user_created_profile') then
    execute 'drop trigger if exists on_auth_user_created_profile on auth.users';
    execute 'create trigger on_auth_user_created_profile after insert on auth.users
             for each row execute function private.handle_new_user_profile()';
  end if;
end $$;

-- Backfill missing profiles (role employee).
do $$ begin
  insert into public.profiles (id, email, role)
  select u.id, u.email, 'employee' from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
  on conflict (id) do nothing;
exception when others then
  raise warning 'profile backfill skipped: %', sqlerrm;
end $$;

-- Hardened role management: server-side admin check, valid roles only,
-- the last admin can never be demoted.
-- Replace every previous version of admin_set_user_role (whatever its argument
-- types were) so no weaker overload stays callable.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure::text as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'admin_set_user_role' loop
    execute format('drop function %s', r.sig);
    raise notice 'replaced old function: %', r.sig;
  end loop;
end $$;
create function public.admin_set_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_old text;
begin
  if v_caller is null or not private.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if new_role is null or new_role not in ('employee','manager','admin') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if target_user_id = v_caller and new_role <> 'admin' then
    raise exception 'cannot demote yourself' using errcode = '42501';
  end if;
  select role into v_old from public.profiles where id = target_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if v_old = 'admin' and new_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'cannot demote the last admin' using errcode = '42501';
  end if;
  update public.profiles set role = new_role where id = target_user_id;
  -- keep the existing updated_at column (if present) in sync
  if exists (select 1 from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'updated_at' and not attisdropped) then
    execute 'update public.profiles set updated_at = now() where id = $1' using target_user_id;
  end if;
end;
$$;
revoke all on function public.admin_set_user_role(uuid, text) from public, anon;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. user_app_state (one private JSON document per employee)
-- ---------------------------------------------------------------------
create table if not exists public.user_app_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
-- Safety check: the isolation rules below need owner_id to be a unique uuid.
-- If the real table differs, stop here (the whole file is rolled back).
do $$ begin
  if (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
      where a.attrelid = 'public.user_app_state'::regclass and a.attname = 'owner_id' and not a.attisdropped) is distinct from 'uuid' then
    raise exception 'user_app_state.owner_id must be of type uuid — migration aborted, nothing was changed';
  end if;
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.user_app_state'::regclass and i.indisunique and i.indnkeyatts = 1
      and i.indkey[0] = (select attnum from pg_attribute where attrelid = 'public.user_app_state'::regclass and attname = 'owner_id')
  ) then
    raise exception 'user_app_state.owner_id must be unique (primary key) — migration aborted, nothing was changed';
  end if;
end $$;

alter table public.user_app_state add column if not exists revision bigint not null default 0;
alter table public.user_app_state add column if not exists updated_by uuid;
alter table public.user_app_state add column if not exists updated_at timestamptz default now();
alter table public.user_app_state enable row level security;

revoke all on public.user_app_state from anon, authenticated;
-- Direct writes stay possible (owner-only, no DELETE) until part 2 is applied,
-- so the currently deployed frontend keeps working during the switch.
-- Re-running this file after part 2 keeps the RPC-only lock.
do $$ begin
  if coalesce(obj_description('public.user_app_state'::regclass, 'pg_class'), '') like '%rpc-only-writes%' then
    grant select on public.user_app_state to authenticated;
  else
    grant select, insert, update on public.user_app_state to authenticated;
  end if;
end $$;

create policy user_app_state_select_own on public.user_app_state
  for select to authenticated using (owner_id = (select auth.uid()));
create policy user_app_state_insert_own on public.user_app_state
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy user_app_state_update_own on public.user_app_state
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy user_app_state_delete_own on public.user_app_state
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Every write bumps the revision (also writes from the old frontend), owner
-- can never change, audit columns are set by the server.
create or replace function private.user_app_state_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'owner_id cannot be changed' using errcode = '42501';
    end if;
    if new.revision is not distinct from old.revision then
      new.revision := old.revision + 1;
    end if;
  else
    new.revision := greatest(coalesce(new.revision, 0), 1);
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
revoke all on function private.user_app_state_guard() from public;
drop trigger if exists user_app_state_guard on public.user_app_state;
create trigger user_app_state_guard
  before insert or update on public.user_app_state
  for each row execute function private.user_app_state_guard();

-- Optimistic-concurrency save. Returns {status:'ok'|'conflict', revision, updated_at}.
-- A device can only save if it is based on the latest revision, so an old
-- device can never silently overwrite newer data.
create or replace function public.save_app_state(p_state jsonb, p_base_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rev bigint;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'state must be a JSON object' using errcode = '22023';
  end if;
  if octet_length(p_state::text) > 15 * 1024 * 1024 then
    raise exception 'state too large' using errcode = '54000';
  end if;

  update public.user_app_state
     set state = p_state, revision = revision + 1
   where owner_id = v_uid and revision = coalesce(p_base_revision, 0)
  returning revision, updated_at into v_rev, v_at;
  if found then
    return jsonb_build_object('status','ok','revision',v_rev,'updated_at',v_at);
  end if;

  select revision, updated_at into v_rev, v_at
    from public.user_app_state where owner_id = v_uid;
  if not found and coalesce(p_base_revision, 0) = 0 then
    insert into public.user_app_state (owner_id, state, revision)
    values (v_uid, p_state, 1)
    on conflict (owner_id) do nothing
    returning revision, updated_at into v_rev, v_at;
    if found then
      return jsonb_build_object('status','ok','revision',v_rev,'updated_at',v_at);
    end if;
    select revision, updated_at into v_rev, v_at
      from public.user_app_state where owner_id = v_uid;
  end if;
  return jsonb_build_object('status','conflict','revision',coalesce(v_rev,0),'updated_at',v_at);
end;
$$;
revoke all on function public.save_app_state(jsonb, bigint) from public, anon;
grant execute on function public.save_app_state(jsonb, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 4. companies (shared catalogue: names, wholesale price, logo)
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id bigint primary key,
  name text not null,
  wholesale_price numeric not null default 0,
  logo text
);
alter table public.companies enable row level security;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_logo_safe'
                 and conrelid = 'public.companies'::regclass) then
    alter table public.companies add constraint companies_logo_safe check (
      logo is null or logo = ''
      or (length(logo) <= 1500000 and logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'companies_name_len'
                 and conrelid = 'public.companies'::regclass) then
    alter table public.companies add constraint companies_name_len
      check (char_length(name) between 1 and 80) not valid;
  end if;
end $$;

revoke all on public.companies from anon, authenticated;
grant select, insert, update, delete on public.companies to authenticated;

create policy companies_select_signed_in on public.companies
  for select to authenticated using (true);
create policy companies_insert_admin on public.companies
  for insert to authenticated with check ((select private.is_admin()));
create policy companies_update_admin on public.companies
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy companies_delete_admin on public.companies
  for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------
-- 5. Legacy shared app_state (single row id=1 used before 2026-10-01).
--    No longer used by the app: lock it completely, keep the data.
-- ---------------------------------------------------------------------
do $$ begin
  if to_regclass('public.app_state') is not null then
    execute 'alter table public.app_state enable row level security';
    execute 'revoke all on public.app_state from anon, authenticated';
  end if;
end $$;

-- Any other table in public that we do not know about: no client access.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p','v','m')
             and c.relname not in ('profiles','user_app_state','companies') loop
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
    raise notice 'locked unknown/legacy table: public.%', r.relname;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Functions: anon cannot call any SECURITY DEFINER function in "public"
--    (those are the ones that bypass RLS). Extension functions are skipped.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
             and p.prorettype <> 'trigger'::regtype            -- trigger functions are not callable via the API
             and not exists (select 1 from pg_depend d
                             where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Report (read-only): review anything listed here.
-- ---------------------------------------------------------------------
select 'security definer function in public' as finding, p.oid::regprocedure::text as object
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and p.proname not in ('admin_set_user_role','save_app_state')
union all
select 'table without RLS', c.oid::regclass::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
union all
select 'non-admin role value (check manually)', p.id::text || ' = ' || coalesce(p.role,'<null>')
from public.profiles p where p.role is null or p.role not in ('employee','manager','admin');
