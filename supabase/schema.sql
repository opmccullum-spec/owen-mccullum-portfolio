-- Client portal schema.
--
-- HOW TO RUN THIS: open your Supabase project -> SQL Editor -> New query,
-- paste this whole file in, and click "Run". Safe to re-run: every
-- statement is written to not fail if it's already been applied.
--
-- This creates:
--   - profiles   one row per logged-in person (client or Owen), auto-created
--                on signup via a trigger on auth.users.
--   - invoices   Phase 1 (Stripe) will fill this in.
--   - contracts  Phase 2 (Documenso e-signature) will fill this in.
--   - bookings   Phase 3 (Google Calendar) will fill this in.
--
-- Security model: Row Level Security (RLS) is on for every table. A logged
-- in client can only ever SELECT their own rows (via the anon key, which is
-- what the portal pages use on their behalf). All writes (creating an
-- invoice, marking a contract signed, etc.) happen from trusted server code
-- using the service_role key, which bypasses RLS entirely — clients never
-- get direct write access to these tables.

-- ── profiles ────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own row" on public.profiles;
create policy "profiles: read own row" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles: update own row" on public.profiles;
create policy "profiles: update own row" on public.profiles
  for update using (id = auth.uid());

-- Auto-create a profile row whenever someone signs up via Supabase Auth
-- (e.g. after clicking their magic link for the first time).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── invoices (Phase 1) ──────────────────────────────────────────────────
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  stripe_invoice_id text,
  description text not null,
  amount_cents integer not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'void')),
  due_date date,
  created_at timestamptz not null default now()
);

alter table public.invoices enable row level security;

drop policy if exists "invoices: read own rows" on public.invoices;
create policy "invoices: read own rows" on public.invoices
  for select using (client_id = auth.uid());

-- ── contracts (Phase 2) ─────────────────────────────────────────────────
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  documenso_document_id text,
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'signed', 'voided')),
  signed_pdf_url text,
  created_at timestamptz not null default now()
);

alter table public.contracts enable row level security;

drop policy if exists "contracts: read own rows" on public.contracts;
create policy "contracts: read own rows" on public.contracts
  for select using (client_id = auth.uid());

-- ── bookings (Phase 3) ──────────────────────────────────────────────────
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  google_event_id text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table public.bookings enable row level security;

drop policy if exists "bookings: read own rows" on public.bookings;
create policy "bookings: read own rows" on public.bookings
  for select using (client_id = auth.uid());

-- ── permissions ─────────────────────────────────────────────────────────
-- Row Level Security controls WHICH rows a role can see; it doesn't grant
-- table access in the first place. Tables created through Supabase's Table
-- Editor UI get these grants automatically — tables created via raw SQL
-- (like this file) don't, so without this block every query (including
-- from the service_role key, which bypasses RLS but still needs the
-- underlying table grant) fails with "permission denied for table ...".
grant usage on schema public to authenticated, service_role;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

grant select on public.invoices to authenticated;
grant select, insert, update, delete on public.invoices to service_role;

grant select on public.contracts to authenticated;
grant select, insert, update, delete on public.contracts to service_role;

grant select on public.bookings to authenticated;
grant select, insert, update, delete on public.bookings to service_role;

-- ── invoicing (Phase 1) ─────────────────────────────────────────────────
-- Cached Stripe Customer id so repeat invoices for the same client reuse
-- one Stripe Customer instead of creating a new one every time.
alter table public.profiles add column if not exists stripe_customer_id text;

-- Stripe's hosted pay-page link, stored so the portal can render a "Pay
-- now" link without calling Stripe's API on every page view.
alter table public.invoices add column if not exists hosted_invoice_url text;

-- ── make yourself (Owen) an admin ──────────────────────────────────────
-- Run this SEPARATELY, after you've logged into the portal once with your
-- own email (that first login is what creates your profiles row):
--
--   update public.profiles set is_admin = true where email = 'you@example.com';
