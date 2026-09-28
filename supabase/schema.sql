-- Trimaco Route — database schema (phase A: capture the daily schedule).
-- Paste into Supabase → SQL Editor → Run. Safe to run again: every
-- statement is idempotent.
--
-- Access model: a login alone gives nothing. A user sees data only once an
-- admin has given their profile the role 'planner' or 'admin' (new logins
-- start as 'pending'). The project was created with "Automatically expose
-- new tables" OFF, so the API reaches only what is granted below, and
-- anonymous visitors get nothing at all.

-- ============ tables ============

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null default 'pending' check (role in ('admin', 'planner', 'pending')),
  created_at timestamptz not null default now()
);

create table if not exists public.workers (
  id text primary key,                          -- short latin id, e.g. 'aviv'
  name text not null unique,                    -- as Adi writes it
  aliases text[] not null default '{}',
  can_drive boolean not null default true,
  can_lift boolean not null default false,      -- סבלות (20 kg+)
  can_assemble boolean not null default false,  -- הרכבת הזמנות
  is_technical boolean not null default false,  -- service technician, not in the delivery pool
  work_days smallint[] not null default '{0,1,2,3,4}', -- 0 = Sunday
  active boolean not null default true,
  sort_order int not null default 100
);

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  aliases text[] not null default '{}',
  region text not null default 'unknown'
    check (region in ('center', 'tlv', 'sharon', 'jerusalem', 'south', 'north', 'unknown')),
  kind text not null default 'customer'
    check (kind in ('hospital', 'clinic', 'customer', 'city', 'depot', 'other')),
  city text,
  address text,
  lat double precision,
  lng double precision,
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.days (
  date date primary key,
  raw_text text not null,                       -- the WhatsApp message as sent
  intro text,
  vehicle_notes text[] not null default '{}',   -- "סידור רכב"
  notes text[] not null default '{}',
  source text not null default 'paste' check (source in ('paste', 'whatsapp_export')),
  message_sent_at timestamptz,
  saved_by uuid default auth.uid() references auth.users (id) on delete set null,
  saved_at timestamptz not null default now(),
  version int not null default 1
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  date date not null references public.days (date) on delete cascade,
  worker_id text references public.workers (id) on delete set null,
  worker_label text not null,
  seq int not null,
  place_id uuid references public.places (id) on delete set null,
  location_text text,                           -- the place as written
  description text,
  task_types text[] not null default '{}',
  is_field boolean not null default true,       -- false = warehouse / orders prep
  window_start time,
  window_end time,
  address text,
  flags text[] not null default '{}',
  raw_line text not null
);
create index if not exists tasks_date_idx on public.tasks (date);
create index if not exists tasks_place_idx on public.tasks (place_id);
create index if not exists tasks_worker_idx on public.tasks (worker_id);

-- Every save of a day, so later corrections to a schedule are kept.
create table if not exists public.day_versions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  raw_text text not null,
  saved_by uuid default auth.uid() references auth.users (id) on delete set null,
  saved_at timestamptz not null default now()
);
create index if not exists day_versions_date_idx on public.day_versions (date);

-- ============ helpers ============

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'planner'));
$$;

-- New login → a 'pending' profile until an admin approves it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, split_part(new.email, '@', 1), split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users created before this script ran.
insert into public.profiles (id, username, display_name)
select id, split_part(email, '@', 1), split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- A daily call from .github/workflows/keepalive.yml, so the free project is
-- never a week without database activity. Returns nothing but "1".
create or replace function public.ping() returns int
language sql stable as $$ select 1 $$;

-- ============ write operations ============

-- Replaces one day's schedule in a single transaction.
create or replace function public.save_day(p_date date, p_day jsonb, p_tasks jsonb) returns void
language plpgsql set search_path = public as $$
begin
  insert into public.days (date, raw_text, intro, vehicle_notes, notes, source, message_sent_at)
  values (
    p_date,
    p_day ->> 'raw_text',
    p_day ->> 'intro',
    array(select jsonb_array_elements_text(coalesce(p_day -> 'vehicle_notes', '[]'))),
    array(select jsonb_array_elements_text(coalesce(p_day -> 'notes', '[]'))),
    coalesce(p_day ->> 'source', 'paste'),
    (p_day ->> 'message_sent_at')::timestamptz
  )
  on conflict (date) do update set
    raw_text = excluded.raw_text,
    intro = excluded.intro,
    vehicle_notes = excluded.vehicle_notes,
    notes = excluded.notes,
    source = excluded.source,
    message_sent_at = excluded.message_sent_at,
    saved_by = auth.uid(),
    saved_at = now(),
    version = days.version + 1;

  delete from public.tasks where date = p_date;

  insert into public.tasks (date, worker_id, worker_label, seq, place_id, location_text, description,
                            task_types, is_field, window_start, window_end, address, flags, raw_line)
  select
    p_date,
    t ->> 'worker_id',
    t ->> 'worker_label',
    (t ->> 'seq')::int,
    nullif(t ->> 'place_id', '')::uuid,
    t ->> 'location_text',
    t ->> 'description',
    array(select jsonb_array_elements_text(coalesce(t -> 'task_types', '[]'))),
    coalesce((t ->> 'is_field')::boolean, true),
    nullif(t ->> 'window_start', '')::time,
    nullif(t ->> 'window_end', '')::time,
    t ->> 'address',
    array(select jsonb_array_elements_text(coalesce(t -> 'flags', '[]'))),
    t ->> 'raw_line'
  from jsonb_array_elements(p_tasks) as t;

  insert into public.day_versions (date, raw_text) values (p_date, p_day ->> 'raw_text');
end $$;

-- Remembers another way a place is written ("סוריה" → סורוקה).
create or replace function public.add_place_alias(p_place uuid, p_alias text) returns void
language sql set search_path = public as $$
  update public.places
  set aliases = array(
    select distinct a from unnest(aliases || array[trim(p_alias)]) as a
    where a <> '' and a <> name)
  where id = p_place;
$$;

-- Points saved tasks written as p_text (and still without a place) at p_place.
create or replace function public.resolve_location_text(p_text text, p_place uuid) returns void
language plpgsql set search_path = public as $$
begin
  update public.tasks set place_id = p_place where place_id is null and location_text = p_text;
  perform public.add_place_alias(p_place, p_text);
end $$;

-- Folds a duplicate place into another one (admins only).
create or replace function public.merge_places(p_source uuid, p_target uuid) returns void
language plpgsql set search_path = public as $$
declare
  src public.places;
begin
  if not public.is_admin() then
    raise exception 'admins only';
  end if;
  if p_source = p_target then
    return;
  end if;
  select * into src from public.places where id = p_source;
  if not found then
    raise exception 'place not found';
  end if;
  update public.tasks set place_id = p_target where place_id = p_source;
  update public.places
  set aliases = array(
    select distinct a from unnest(aliases || src.aliases || array[src.name]) as a
    where a <> '' and a <> name)
  where id = p_target;
  delete from public.places where id = p_source;
end $$;

-- ============ access ============

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles, public.workers, public.places, public.days, public.tasks, public.day_versions
  to authenticated;
revoke all on
  public.profiles, public.workers, public.places, public.days, public.tasks, public.day_versions
  from anon;

revoke execute on function
  public.is_admin(), public.is_member(), public.handle_new_user(), public.save_day(date, jsonb, jsonb),
  public.add_place_alias(uuid, text), public.resolve_location_text(text, uuid), public.merge_places(uuid, uuid)
  from public, anon;
grant execute on function
  public.is_admin(), public.is_member(), public.save_day(date, jsonb, jsonb), public.add_place_alias(uuid, text),
  public.resolve_location_text(text, uuid), public.merge_places(uuid, uuid)
  to authenticated;
grant execute on function public.ping() to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.workers enable row level security;
alter table public.places enable row level security;
alter table public.days enable row level security;
alter table public.tasks enable row level security;
alter table public.day_versions enable row level security;

-- profiles: see yourself; admins see and edit everyone
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- workers: members read, admins edit
drop policy if exists "workers read" on public.workers;
create policy "workers read" on public.workers for select to authenticated using (public.is_member());
drop policy if exists "workers admin insert" on public.workers;
create policy "workers admin insert" on public.workers for insert to authenticated with check (public.is_admin());
drop policy if exists "workers admin update" on public.workers;
create policy "workers admin update" on public.workers for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "workers admin delete" on public.workers;
create policy "workers admin delete" on public.workers for delete to authenticated using (public.is_admin());

-- places: members read and add (Adi confirms new places); only admins delete
drop policy if exists "places read" on public.places;
create policy "places read" on public.places for select to authenticated using (public.is_member());
drop policy if exists "places insert" on public.places;
create policy "places insert" on public.places for insert to authenticated with check (public.is_member());
drop policy if exists "places update" on public.places;
create policy "places update" on public.places for update to authenticated
  using (public.is_member()) with check (public.is_member());
drop policy if exists "places admin delete" on public.places;
create policy "places admin delete" on public.places for delete to authenticated using (public.is_admin());

-- days: members read and save; only admins delete a whole day
drop policy if exists "days read" on public.days;
create policy "days read" on public.days for select to authenticated using (public.is_member());
drop policy if exists "days insert" on public.days;
create policy "days insert" on public.days for insert to authenticated with check (public.is_member());
drop policy if exists "days update" on public.days;
create policy "days update" on public.days for update to authenticated
  using (public.is_member()) with check (public.is_member());
drop policy if exists "days admin delete" on public.days;
create policy "days admin delete" on public.days for delete to authenticated using (public.is_admin());

-- tasks: rewritten on every save of their day
drop policy if exists "tasks read" on public.tasks;
create policy "tasks read" on public.tasks for select to authenticated using (public.is_member());
drop policy if exists "tasks insert" on public.tasks;
create policy "tasks insert" on public.tasks for insert to authenticated with check (public.is_member());
drop policy if exists "tasks update" on public.tasks;
create policy "tasks update" on public.tasks for update to authenticated
  using (public.is_member()) with check (public.is_member());
drop policy if exists "tasks delete" on public.tasks;
create policy "tasks delete" on public.tasks for delete to authenticated using (public.is_member());

-- day_versions: append-only history
drop policy if exists "versions read" on public.day_versions;
create policy "versions read" on public.day_versions for select to authenticated using (public.is_member());
drop policy if exists "versions insert" on public.day_versions;
create policy "versions insert" on public.day_versions for insert to authenticated with check (public.is_member());
