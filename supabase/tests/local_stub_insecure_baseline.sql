-- LOCAL TEST ONLY (never run on Supabase).
-- Recreates the Supabase roles/auth pieces the app relies on, plus a
-- deliberately INSECURE version of the app schema (worst case of what may
-- exist in production) so the migrations can be proven to close every hole.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase default grants on the public schema
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------- insecure baseline ----------
create table public.profiles (
  id uuid primary key references auth.users(id), email text, full_name text,
  role text default 'employee', created_at timestamptz default now());
alter table public.profiles enable row level security;
create policy "read all profiles" on public.profiles for select to authenticated using (true);
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid());
create policy "insert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());

create table public.user_app_state (
  owner_id uuid primary key references auth.users(id), state jsonb, updated_by uuid, updated_at timestamptz);
alter table public.user_app_state enable row level security;
create policy "everything for signed in" on public.user_app_state for all to authenticated using (true) with check (true);

create table public.companies (id bigint primary key, name text, wholesale_price numeric, logo text);
-- RLS deliberately left disabled here

create table public.app_state (id int primary key, state jsonb, updated_by uuid, updated_at timestamptz);
alter table public.app_state enable row level security;
create policy "shared state" on public.app_state for all to authenticated using (true) with check (true);

create function public.is_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create function public.admin_set_user_role(target_user_id uuid, new_role text) returns void
language plpgsql security definer as $$
begin
  update public.profiles set role = new_role where id = target_user_id;   -- no caller check!
end $$;
-- a second, older overload with different argument types (must also disappear)
create function public.admin_set_user_role(target_user_id text, new_role text) returns void
language plpgsql security definer as $$
begin
  update public.profiles set role = new_role where id = target_user_id::uuid;
end $$;
-- an unknown SECURITY DEFINER helper that leaks data (anon must lose access)
create function public.debug_count_states() returns bigint
language sql security definer as $$ select count(*) from public.user_app_state $$;

-- ---------- seed ----------
insert into auth.users values
  ('aaaaaaaa-0000-0000-0000-00000000000a','a@test.local'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','b@test.local'),
  ('cccccccc-0000-0000-0000-00000000000c','admin@test.local');
insert into public.profiles (id,email,role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a','a@test.local','employee'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','b@test.local','employee'),
  ('cccccccc-0000-0000-0000-00000000000c','admin@test.local','admin');
insert into public.user_app_state (owner_id,state) values
  ('aaaaaaaa-0000-0000-0000-00000000000a','{"owner":"A","sims":[]}'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','{"owner":"B","sims":[]}'),
  ('cccccccc-0000-0000-0000-00000000000c','{"owner":"ADMIN","sims":[]}');
insert into public.companies values (1,'سكاي',45,''),(2,'ليان',50,'');
insert into public.app_state values (1,'{"legacy":"all business data"}',null,now());
