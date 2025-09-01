create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  firstname text, lastname text, dob date, gender text, phone text,
  address text, zip text, city text, country text default 'France',
  building text, street_number text, street text, address_extra text,
  allergies text[] default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.profiles enable row level security;
create or replace function public.set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
for each row execute procedure public.set_updated_at();
create policy "read own profile"  on public.profiles for select using (auth.uid() = id);
create policy "insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "update own profile" on public.profiles for update using (auth.uid() = id);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  category text not null check (category in ('restaurant','snack','boulangerie','autre')),
  note int not null check (note between 1 and 5),
  address text, lat double precision not null, lng double precision not null,
  comment text, created_at timestamptz default now()
);
alter table public.reviews enable row level security;
create policy "public can read reviews" on public.reviews for select using (true);
create policy "auth can insert reviews" on public.reviews for insert with check (auth.role() = 'authenticated');
create policy "owner can update" on public.reviews for update using (auth.uid() = user_id);
create policy "owner can delete" on public.reviews for delete using (auth.uid() = user_id);

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  date date not null, trigger text, symptoms text,
  severity int not null check (severity between 1 and 5),
  notes text, created_at timestamptz default now()
);
alter table public.diary_entries enable row level security;
create policy "owner read diary"   on public.diary_entries for select using (auth.uid() = user_id);
create policy "owner insert diary" on public.diary_entries for insert with check (auth.uid() = user_id);
create policy "owner update diary" on public.diary_entries for update using (auth.uid() = user_id);
create policy "owner delete diary" on public.diary_entries for delete using (auth.uid() = user_id);
