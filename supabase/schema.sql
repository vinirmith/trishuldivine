-- Trishul Divine — products + admin schema
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  price numeric(10,2) not null default 0,
  category text not null,
  sizes text[] not null default '{}',
  images text[] not null default '{}',
  in_stock boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_category_idx on public.products (category);
create index if not exists products_in_stock_idx on public.products (in_stock);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Admin allowlist — who is allowed to write to products / admin panel
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so RLS policies (and the client, via RPC) can check
-- "is the current user an admin" without granting direct table access.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

alter table public.products enable row level security;
alter table public.admin_users enable row level security;

drop policy if exists "Public can read products" on public.products;
create policy "Public can read products" on public.products
  for select using (true);

drop policy if exists "Admins can insert products" on public.products;
create policy "Admins can insert products" on public.products
  for insert with check (public.is_admin());

drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products" on public.products
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete products" on public.products;
create policy "Admins can delete products" on public.products
  for delete using (public.is_admin());

drop policy if exists "Admins can read own admin row" on public.admin_users;
create policy "Admins can read own admin row" on public.admin_users
  for select using (auth.uid() = user_id);

-- No client-facing insert/update/delete policy on admin_users on purpose —
-- grant admin access from the SQL editor only (see bottom of this file).

-- ---------------------------------------------------------------------------
-- Storage bucket for product images
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "Public read product images" on storage.objects;
create policy "Public read product images" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "Admins upload product images" on storage.objects;
create policy "Admins upload product images" on storage.objects
  for insert with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins update product images" on storage.objects;
create policy "Admins update product images" on storage.objects
  for update using (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins delete product images" on storage.objects;
create policy "Admins delete product images" on storage.objects
  for delete using (bucket_id = 'product-images' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Seed data — matches what's currently hardcoded on the site, so the shop
-- pages and admin list aren't empty on first load. Safe to edit/delete from
-- the admin panel afterwards.
-- ---------------------------------------------------------------------------
insert into public.products (name, description, price, category, sizes, images, in_stock)
select * from (values
  ('Smoky Quartz Bracelet', 'Natural gemstone bracelet, wearable daily.', 1450, 'bracelets', array['6.5 in','7 in','7.5 in'], array['images/Gemstone bracelets smoky-quartz.webp'], true),
  ('Gemstone Mala Bracelet', 'Beaded gemstone mala bracelet, multiple sizes available.', 1600, 'bracelets', array['6.5 in','7 in','7.5 in','8 in'], array['images/Bracelet/Bracelet1.jpeg'], true),
  ('Gemstone Mala', 'Hand-strung gemstone mala, 108 beads.', 2200, 'bracelets', array['One size'], array['images/mala-bracelets.jpeg'], true),
  ('Rudraksha Pendant', 'Traditional, quality-checked Rudraksha pendant.', 1800, 'rudraksha', array['One size'], array['images/rudraksha.webp'], true),
  ('Rudraksha Mala', '108-bead Rudraksha mala for daily practice.', 2000, 'rudraksha', array['One size'], array['images/rudraksha_mala.jpg'], true),
  ('Classic Chain', 'Everyday wear chain, finished and polished.', 1800, 'chains', array['18 in','20 in','22 in'], array['images/chain/chain1.jpeg'], true)
) as seed(name, description, price, category, sizes, images, in_stock)
where not exists (select 1 from public.products);

-- ---------------------------------------------------------------------------
-- Grant yourself admin access
-- ---------------------------------------------------------------------------
-- 1. Sign up / log in once at auth.html (or admin.html) with the email you
--    want to use as admin, so a row exists in auth.users.
-- 2. Then run, with your email:
--
--    insert into public.admin_users (user_id, email)
--    select id, email from auth.users where email = 'you@example.com'
--    on conflict (user_id) do nothing;
