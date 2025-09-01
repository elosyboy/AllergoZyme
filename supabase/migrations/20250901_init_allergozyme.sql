-- ============ Extensions ============
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============ Table profiles ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  firstname text,
  lastname text,
  dob date,
  gender text,
  phone text,
  address text,
  zip text,
  city text,
  country text default 'France',
  allergies jsonb default '[]',
  building text,
  street_number text,
  street text,
  address_extra text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Trigger updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
before update on public.profiles
for each row execute procedure public.set_updated_at();

-- ============ Table reviews ============
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'autre',
  note integer not null check (note between 1 and 5),
  address text,
  lat double precision not null,
  lng double precision not null,
  comment text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index
create index if not exists reviews_user_id_created_at_idx on public.reviews(user_id, created_at desc);
create index if not exists reviews_category_idx on public.reviews(category);
create index if not exists reviews_lat_lng_idx on public.reviews(lat, lng);

-- Trigger updated_at
drop trigger if exists trg_reviews_updated on public.reviews;
create trigger trg_reviews_updated
before update on public.reviews
for each row execute procedure public.set_updated_at();

-- Activer RLS (les policies sont ajoutées dans la migration fix_policies)
alter table if exists public.profiles enable row level security;
alter table if exists public.reviews  enable row level security;

