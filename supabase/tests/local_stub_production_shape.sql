-- LOCAL TEST ONLY. Mirrors the PRODUCTION schema as inspected on 2026-10-03
-- (columns, constraints, policies, functions, trigger, wide grants), plus seed rows.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin noinherit; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
-- as in production: sign-ups are inserted by supabase_auth_admin, the owner of auth.users
grant usage on schema auth to supabase_auth_admin;
alter table auth.users owner to supabase_auth_admin;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text, full_name text,
  role text not null default 'employee' check (role = any (array['admin','manager','employee'])),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.user_app_state (owner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb, updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now());
create table public.companies (id bigint primary key, name text not null, wholesale_price numeric not null default 0,
  logo text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.app_state (id bigint primary key, state jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now());
alter table public.profiles enable row level security;
alter table public.user_app_state enable row level security;
alter table public.companies enable row level security;
alter table public.app_state enable row level security;

create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, email, full_name, role) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''), 'employee') on conflict (id) do nothing; return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create function public.admin_set_user_role(target_user_id uuid, new_role text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if new_role not in ('admin','manager','employee') then raise exception 'invalid role'; end if;
  if target_user_id = auth.uid() and new_role <> 'admin' then raise exception 'cannot demote yourself'; end if;
  update public.profiles set role = new_role, updated_at = now() where id = target_user_id;
  if not found then raise exception 'user profile not found'; end if;
end $$;

create policy "admins can delete shared companies" on public.companies for delete to authenticated using (is_admin());
create policy "admins can insert shared companies" on public.companies for insert to authenticated with check (is_admin());
create policy "admins can update shared companies" on public.companies for update to authenticated using (is_admin()) with check (is_admin());
create policy "authenticated can read shared companies" on public.companies for select to authenticated using (true);
create policy "admins can read all profiles" on public.profiles for select to authenticated using (is_admin());
create policy "users can read own profile" on public.profiles for select to authenticated using ((auth.uid() = id) or is_admin());
create policy "users can insert own app state" on public.user_app_state for insert to authenticated with check (auth.uid() = owner_id);
create policy "users can read own app state" on public.user_app_state for select to authenticated using (auth.uid() = owner_id);
create policy "users can update own app state" on public.user_app_state for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-00000000000a','owner@test.local'),('bbbbbbbb-0000-0000-0000-00000000000b','emp@test.local');
update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
insert into public.user_app_state (owner_id, state) values ('aaaaaaaa-0000-0000-0000-00000000000a','{"owner":"admin","debtLedger":{"transactions":[1,2,3]}}'),('bbbbbbbb-0000-0000-0000-00000000000b','{"owner":"emp"}');
insert into public.companies (id,name,wholesale_price,logo) values (1,'سكاي',45,''),(2,'ليان',50,'');
insert into public.app_state values (1,'{"legacy":true}',null,now());
