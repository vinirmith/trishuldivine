-- Trishul Divine admin setup
-- Run this in Supabase SQL Editor after creating the user in Authentication.
-- This keeps admin access in the database, which is the real source of truth.

-- 1) Make sure the admin allowlist table exists.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- 2) Grant admin access to one or more approved users.
-- Replace the emails below with the real admin emails you want to allow.
insert into public.admin_users (user_id, email)
select id, email
from auth.users
where email = any (array[
  'admin@demo.com',
  'admin2@demo.com'
])
on conflict (user_id) do update
set email = excluded.email;

-- 3) View current admin list.
select * from public.admin_users order by created_at desc;

-- 4) Optional: remove an admin.
-- delete from public.admin_users where email = 'old-admin@example.com';

-- 5) Optional: create a new user manually in Supabase Auth before granting access.
-- After signup, run step 2 again with the new email.

-- 6) Security note:
-- The frontend should only use Supabase Auth and the public.is_admin() RPC for enforcement.
-- Never store real admin passwords in frontend JS or static HTML.
