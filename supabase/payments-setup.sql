-- Trishul Divine — orders, payments (Razorpay) and order emails
-- Run once in the Supabase SQL editor, AFTER schema.sql. Safe to re-run.
--
-- What this does
--   * Creates/extends customers, orders, order_items and adds payments, refunds, webhook_events.
--   * Locks all of them down: the browser can no longer write orders or payments.
--     Only the Cloudflare Worker (service-role key) writes, through the functions below.
--   * Admins (public.is_admin()) can read everything; signed-in customers can read their own orders.
--   * Ends with a self-test that runs a whole fake order and rolls it back.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.admin_users') is null or to_regprocedure('public.is_admin()') is null then
    raise exception 'Run supabase/schema.sql first (public.admin_users / public.is_admin() are missing).';
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Base tables. These may already exist (they were created by hand in the
-- dashboard), so only the missing ones/columns are added.
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null default '',
  phone text,
  email text,
  address text,
  city text,
  state text,
  pincode text,
  country text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending',
  total_amount numeric(10,2) not null default 0,
  shipping_address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  product_name text not null default '',
  product_image text,
  quantity integer not null default 1,
  unit_price numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

-- Refuse to continue if the hand-made tables use a different id type than this
-- script assumes (better to stop here than to half-migrate a live database).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and data_type <> 'uuid' and (
      (table_name = 'customers'   and column_name in ('id', 'user_id')) or
      (table_name = 'orders'      and column_name in ('id', 'customer_id', 'user_id')) or
      (table_name = 'order_items' and column_name in ('id', 'order_id'))
    )
  ) then
    raise exception 'customers/orders/order_items use non-uuid id columns; this script expects uuid. Stop and review before continuing.';
  end if;
end $$;

-- Legacy columns the old checkout wrote (no-ops when they already exist).
alter table public.customers
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists pincode text,
  add column if not exists country text,
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

alter table public.orders
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists status text not null default 'pending',
  add column if not exists total_amount numeric(10,2) not null default 0,
  add column if not exists shipping_address text,
  add column if not exists notes text;

alter table public.order_items
  add column if not exists order_id uuid references public.orders(id) on delete cascade,
  add column if not exists product_name text,
  add column if not exists product_image text,
  add column if not exists quantity integer not null default 1,
  add column if not exists unit_price numeric(10,2) not null default 0;

-- orders.status must be plain text with no old CHECK list, because the new
-- flow uses pending -> confirmed (and later shipped / delivered / cancelled).
do $$
declare
  c record;
  v_type text;
begin
  select data_type into v_type from information_schema.columns
  where table_schema = 'public' and table_name = 'orders' and column_name = 'status';
  if v_type is distinct from 'text' then
    execute 'alter table public.orders alter column status drop default';
    execute 'alter table public.orders alter column status type text using status::text';
    execute 'alter table public.orders alter column status set default ''pending''';
  end if;

  for c in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~ '\mstatus\M'
  loop
    execute format('alter table public.orders drop constraint %I', c.conname);
  end loop;
end $$;

-- New order columns.
alter table public.orders
  add column if not exists order_number text,
  add column if not exists public_token uuid not null default gen_random_uuid(),
  add column if not exists payment_status text not null default 'created',
  add column if not exists currency text not null default 'INR',
  add column if not exists subtotal numeric(10,2),
  add column if not exists shipping_fee numeric(10,2) not null default 0,
  add column if not exists razorpay_order_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists shipping_details jsonb,
  add column if not exists confirmation_email_status text not null default 'pending',
  add column if not exists confirmation_email_claimed_at timestamptz,
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists confirmation_email_error text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('created', 'paid', 'failed', 'partially_refunded', 'refunded'));

alter table public.orders drop constraint if exists orders_confirmation_email_status_check;
alter table public.orders add constraint orders_confirmation_email_status_check
  check (confirmation_email_status in ('pending', 'sending', 'sent', 'failed'));

alter table public.order_items
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists size text;

create sequence if not exists public.order_number_seq start 1001;

create unique index if not exists orders_order_number_uidx on public.orders (order_number);
create unique index if not exists orders_public_token_uidx on public.orders (public_token);
create unique index if not exists orders_razorpay_order_id_uidx on public.orders (razorpay_order_id);
create index if not exists orders_payment_status_created_idx on public.orders (payment_status, created_at desc);
create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists order_items_order_id_idx on public.order_items (order_id);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Payments, refunds, webhook log
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  razorpay_order_id text not null,
  razorpay_payment_id text not null unique,
  amount numeric(10,2) not null,
  currency text not null default 'INR',
  method text,
  status text not null check (status in ('authorized', 'captured', 'failed', 'mismatch', 'refunded', 'partially_refunded')),
  signature_verified boolean not null default false,
  error_code text,
  error_description text,
  raw_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_order_id_idx on public.payments (order_id);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  razorpay_refund_id text not null unique,
  amount numeric(10,2) not null,
  status text not null,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists refunds_order_id_idx on public.refunds (order_id);

drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at
before update on public.refunds
for each row execute function public.set_updated_at();

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'razorpay',
  event_id text not null,
  event_type text not null,
  payload jsonb,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error text,
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (source, event_id)
);

-- ---------------------------------------------------------------------------
-- Row level security. The browser can only READ (admins: everything,
-- customers: their own orders). Nothing here can be written from the browser.
-- ---------------------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('customers', 'orders', 'order_items', 'payments', 'refunds', 'webhook_events')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.webhook_events enable row level security;

create policy "Admins read customers" on public.customers
  for select using (public.is_admin());
create policy "Customers read own customer row" on public.customers
  for select using (user_id is not null and user_id = auth.uid());

create policy "Admins read orders" on public.orders
  for select using (public.is_admin());
create policy "Customers read own orders" on public.orders
  for select using (user_id is not null and user_id = auth.uid());

create policy "Admins read order items" on public.order_items
  for select using (public.is_admin());
create policy "Customers read own order items" on public.order_items
  for select using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.user_id is not null and o.user_id = auth.uid()
  ));

create policy "Admins read payments" on public.payments
  for select using (public.is_admin());
create policy "Admins read refunds" on public.refunds
  for select using (public.is_admin());
create policy "Admins read webhook events" on public.webhook_events
  for select using (public.is_admin());

revoke all on public.customers, public.orders, public.order_items, public.payments, public.refunds, public.webhook_events from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.customers, public.orders, public.order_items, public.payments, public.refunds, public.webhook_events
  from authenticated;
grant select on public.customers, public.orders, public.order_items, public.payments, public.refunds, public.webhook_events
  to authenticated;

-- ---------------------------------------------------------------------------
-- Server-only functions (called by the Worker with the service-role key).
-- Prices always come from public.products here, never from the browser.
-- ---------------------------------------------------------------------------

-- Creates the customer, order and order lines for a checkout.
create or replace function public.create_checkout_order(
  p_items jsonb,
  p_customer jsonb,
  p_user_id uuid,
  p_shipping_fee numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_product public.products%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_pid uuid;
  v_qty integer;
  v_size text;
  v_subtotal numeric(10,2) := 0;
  v_total numeric(10,2);
  v_shipping numeric(10,2) := greatest(coalesce(p_shipping_fee, 0), 0);
  v_name text := btrim(coalesce(p_customer->>'full_name', ''));
  v_phone text := btrim(coalesce(p_customer->>'phone', ''));
  v_email text := lower(btrim(coalesce(p_customer->>'email', '')));
  v_address text := btrim(coalesce(p_customer->>'address', ''));
  v_city text := btrim(coalesce(p_customer->>'city', ''));
  v_state text := btrim(coalesce(p_customer->>'state', ''));
  v_pincode text := btrim(coalesce(p_customer->>'pincode', ''));
  v_country text := btrim(coalesce(p_customer->>'country', 'India'));
  v_notes text := nullif(btrim(coalesce(p_customer->>'notes', '')), '');
  v_customer_id uuid;
  v_order_id uuid;
  v_number text;
  v_token uuid;
  v_details jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'too_many_items';
  end if;
  if v_name = '' or v_phone = '' or v_email = '' or v_address = '' or v_city = '' or v_state = '' or v_pincode = '' then
    raise exception 'invalid_customer';
  end if;

  for v_line in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid := (v_line->>'product_id')::uuid;
      v_qty := (v_line->>'quantity')::integer;
    exception when others then
      raise exception 'invalid_item';
    end;
    if v_pid is null or v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'invalid_item';
    end if;
    v_size := nullif(btrim(coalesce(v_line->>'size', '')), '');

    select * into v_product from public.products where id = v_pid;
    if not found then
      raise exception 'product_not_found';
    end if;
    if not v_product.in_stock then
      raise exception 'out_of_stock' using detail = v_product.name;
    end if;
    if coalesce(array_length(v_product.sizes, 1), 0) > 0 then
      if v_size is null or not (v_size = any (v_product.sizes)) then
        raise exception 'invalid_size' using detail = v_product.name;
      end if;
    else
      v_size := null;
    end if;
    if v_product.price is null or v_product.price <= 0 then
      raise exception 'invalid_price' using detail = v_product.name;
    end if;

    v_subtotal := v_subtotal + v_product.price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'image', coalesce(v_product.images[1], ''),
      'size', v_size,
      'quantity', v_qty,
      'unit_price', v_product.price
    );
  end loop;

  v_total := v_subtotal + v_shipping;

  select id into v_customer_id from public.customers
  where lower(coalesce(email, '')) = v_email
    and coalesce(phone, '') = v_phone
    and user_id is not distinct from p_user_id
  order by created_at desc
  limit 1;

  if v_customer_id is null then
    insert into public.customers (full_name, phone, email, address, city, state, pincode, country, user_id)
    values (v_name, v_phone, v_email, v_address, v_city, v_state, v_pincode, v_country, p_user_id)
    returning id into v_customer_id;
  end if;

  v_number := 'TD-' || nextval('public.order_number_seq');
  v_details := jsonb_build_object(
    'full_name', v_name, 'phone', v_phone, 'email', v_email, 'address', v_address,
    'city', v_city, 'state', v_state, 'pincode', v_pincode, 'country', v_country
  );

  insert into public.orders (
    customer_id, user_id, status, payment_status, order_number, currency,
    subtotal, shipping_fee, total_amount, shipping_address, shipping_details, notes
  )
  values (
    v_customer_id, p_user_id, 'pending', 'created', v_number, 'INR',
    v_subtotal, v_shipping, v_total,
    concat_ws(', ', v_address, v_city, v_state, v_pincode, v_country),
    v_details, v_notes
  )
  returning id, public_token into v_order_id, v_token;

  insert into public.order_items (order_id, product_id, product_name, product_image, size, quantity, unit_price)
  select v_order_id, (l->>'product_id')::uuid, l->>'name', nullif(l->>'image', ''), l->>'size',
         (l->>'quantity')::integer, (l->>'unit_price')::numeric
  from jsonb_array_elements(v_lines) as l;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_number,
    'public_token', v_token,
    'total_amount', v_total,
    'currency', 'INR',
    'items', v_lines
  );
end;
$$;

create or replace function public.attach_razorpay_order(p_order_id uuid, p_razorpay_order_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders
  set razorpay_order_id = p_razorpay_order_id
  where id = p_order_id and razorpay_order_id is null and payment_status = 'created';
$$;

-- One call returns everything the Worker needs about an order.
create or replace function public.get_order_bundle(
  p_order_id uuid default null,
  p_razorpay_order_id text default null,
  p_public_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders
  where (p_order_id is not null and id = p_order_id)
     or (p_razorpay_order_id is not null and razorpay_order_id = p_razorpay_order_id)
     or (p_public_token is not null and public_token = p_public_token)
  limit 1;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.created_at, i.id) from public.order_items i where i.order_id = v_order.id
    ), '[]'::jsonb),
    'payment', (
      select to_jsonb(p) from public.payments p
      where p.order_id = v_order.id
      order by (p.status in ('captured', 'refunded', 'partially_refunded')) desc, p.created_at desc
      limit 1
    )
  );
end;
$$;

-- Marks an order paid. Safe to call any number of times, from the browser
-- confirmation and the webhook at the same time (the order row is locked).
create or replace function public.mark_order_paid(
  p_razorpay_order_id text,
  p_payment_id text,
  p_amount_paise bigint,
  p_method text,
  p_payload jsonb,
  p_signature_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_expected bigint;
  v_transitioned boolean := false;
begin
  select * into v_order from public.orders where razorpay_order_id = p_razorpay_order_id for update;
  if not found then
    return jsonb_build_object('result', 'order_not_found');
  end if;

  v_expected := round(v_order.total_amount * 100)::bigint;
  if p_amount_paise is not null and p_amount_paise <> v_expected then
    insert into public.payments (order_id, razorpay_order_id, razorpay_payment_id, amount, status, method, signature_verified, raw_payload)
    values (v_order.id, p_razorpay_order_id, p_payment_id, p_amount_paise / 100.0, 'mismatch', p_method, coalesce(p_signature_verified, false), p_payload)
    on conflict (razorpay_payment_id) do nothing;
    return jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id, 'order_number', v_order.order_number);
  end if;

  insert into public.payments (order_id, razorpay_order_id, razorpay_payment_id, amount, status, method, signature_verified, raw_payload, paid_at)
  values (v_order.id, p_razorpay_order_id, p_payment_id, v_expected / 100.0, 'captured', p_method, coalesce(p_signature_verified, false), p_payload, now())
  on conflict (razorpay_payment_id) do update
  set status = case when public.payments.status in ('refunded', 'partially_refunded') then public.payments.status else 'captured' end,
      amount = excluded.amount,
      method = coalesce(excluded.method, public.payments.method),
      signature_verified = public.payments.signature_verified or excluded.signature_verified,
      raw_payload = coalesce(excluded.raw_payload, public.payments.raw_payload),
      paid_at = coalesce(public.payments.paid_at, excluded.paid_at),
      error_code = null,
      error_description = null;

  if v_order.payment_status in ('created', 'failed') then
    update public.orders
    set payment_status = 'paid', status = 'confirmed', paid_at = now()
    where id = v_order.id;
    v_transitioned := true;
  end if;

  return jsonb_build_object(
    'result', 'ok',
    'transitioned', v_transitioned,
    'order_id', v_order.id,
    'order_number', v_order.order_number
  );
end;
$$;

create or replace function public.record_payment_failure(
  p_razorpay_order_id text,
  p_payment_id text,
  p_amount_paise bigint,
  p_method text,
  p_error_code text,
  p_error_description text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where razorpay_order_id = p_razorpay_order_id for update;
  if not found then
    return jsonb_build_object('result', 'order_not_found');
  end if;

  insert into public.payments (order_id, razorpay_order_id, razorpay_payment_id, amount, status, method, error_code, error_description, raw_payload)
  values (v_order.id, p_razorpay_order_id, p_payment_id, coalesce(p_amount_paise, 0) / 100.0, 'failed', p_method, p_error_code, p_error_description, p_payload)
  on conflict (razorpay_payment_id) do update
  set status = 'failed',
      method = coalesce(excluded.method, public.payments.method),
      error_code = excluded.error_code,
      error_description = excluded.error_description,
      raw_payload = coalesce(excluded.raw_payload, public.payments.raw_payload)
  where public.payments.status in ('authorized', 'failed');

  if v_order.payment_status = 'created' then
    update public.orders set payment_status = 'failed' where id = v_order.id;
  end if;

  return jsonb_build_object('result', 'ok', 'order_id', v_order.id, 'order_number', v_order.order_number);
end;
$$;

create or replace function public.record_refund(
  p_razorpay_payment_id text,
  p_refund_id text,
  p_amount_paise bigint,
  p_status text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_refunded numeric(10,2);
  v_full boolean;
begin
  select * into v_payment from public.payments where razorpay_payment_id = p_razorpay_payment_id for update;
  if not found then
    return jsonb_build_object('result', 'payment_not_found');
  end if;

  insert into public.refunds (payment_id, order_id, razorpay_refund_id, amount, status, raw_payload)
  values (v_payment.id, v_payment.order_id, p_refund_id, coalesce(p_amount_paise, 0) / 100.0, coalesce(p_status, 'processed'), p_payload)
  on conflict (razorpay_refund_id) do update
  set status = excluded.status, raw_payload = excluded.raw_payload;

  select coalesce(sum(amount), 0) into v_refunded from public.refunds
  where payment_id = v_payment.id and status = 'processed';

  if v_refunded > 0 then
    v_full := v_refunded >= v_payment.amount;
    update public.payments
    set status = case when v_full then 'refunded' else 'partially_refunded' end
    where id = v_payment.id;
    update public.orders
    set payment_status = case when v_full then 'refunded' else 'partially_refunded' end
    where id = v_payment.order_id and payment_status in ('paid', 'partially_refunded', 'refunded');
  end if;

  return jsonb_build_object('result', 'ok', 'order_id', v_payment.order_id);
end;
$$;

-- Webhook de-duplication. Returns the stored status; 'processed'/'ignored'
-- means this event has already been handled and should be skipped.
create or replace function public.begin_webhook_event(
  p_source text,
  p_event_id text,
  p_event_type text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  insert into public.webhook_events (source, event_id, event_type, payload)
  values (p_source, p_event_id, p_event_type, p_payload)
  on conflict (source, event_id) do update
  set attempts = public.webhook_events.attempts + 1
  returning status into v_status;
  return v_status;
end;
$$;

create or replace function public.finish_webhook_event(
  p_source text,
  p_event_id text,
  p_status text,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.webhook_events
  set status = p_status, error = p_error, processed_at = now()
  where source = p_source and event_id = p_event_id;
$$;

-- Makes sure only one request sends the confirmation email for an order.
-- p_force lets an admin resend an already-sent email.
create or replace function public.claim_confirmation_email(p_order_id uuid, p_force boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.orders
  set confirmation_email_status = 'sending',
      confirmation_email_claimed_at = now(),
      confirmation_email_error = null
  where id = p_order_id
    and payment_status in ('paid', 'partially_refunded', 'refunded')
    and (
      confirmation_email_status in ('pending', 'failed')
      or (p_force and confirmation_email_status = 'sent')
      or (confirmation_email_status = 'sending' and confirmation_email_claimed_at < now() - interval '5 minutes')
    );
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.finish_confirmation_email(p_order_id uuid, p_ok boolean, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders
  set confirmation_email_status = case when p_ok then 'sent' else 'failed' end,
      confirmation_email_sent_at = case when p_ok then now() else confirmation_email_sent_at end,
      confirmation_email_error = case when p_ok then null else left(coalesce(p_error, 'unknown error'), 500) end
  where id = p_order_id;
$$;

-- Only the service role may run these. (Functions are executable by PUBLIC by default.)
revoke all on function public.create_checkout_order(jsonb, jsonb, uuid, numeric) from public, anon, authenticated;
revoke all on function public.attach_razorpay_order(uuid, text) from public, anon, authenticated;
revoke all on function public.get_order_bundle(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.mark_order_paid(text, text, bigint, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.record_payment_failure(text, text, bigint, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_refund(text, text, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.begin_webhook_event(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.finish_webhook_event(text, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_confirmation_email(uuid, boolean) from public, anon, authenticated;
revoke all on function public.finish_confirmation_email(uuid, boolean, text) from public, anon, authenticated;

grant execute on function public.create_checkout_order(jsonb, jsonb, uuid, numeric) to service_role;
grant execute on function public.attach_razorpay_order(uuid, text) to service_role;
grant execute on function public.get_order_bundle(uuid, text, uuid) to service_role;
grant execute on function public.mark_order_paid(text, text, bigint, text, jsonb, boolean) to service_role;
grant execute on function public.record_payment_failure(text, text, bigint, text, text, text, jsonb) to service_role;
grant execute on function public.record_refund(text, text, bigint, text, jsonb) to service_role;
grant execute on function public.begin_webhook_event(text, text, text, jsonb) to service_role;
grant execute on function public.finish_webhook_event(text, text, text, text) to service_role;
grant execute on function public.claim_confirmation_email(uuid, boolean) to service_role;
grant execute on function public.finish_confirmation_email(uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- Self-test: runs a fake order end to end against your real tables and rolls
-- it back. If this block raises an error, do NOT go live — send me the error.
-- ---------------------------------------------------------------------------
do $$
declare
  v_product public.products%rowtype;
  v_created jsonb;
  v_paid jsonb;
  v_again jsonb;
  v_order public.orders%rowtype;
begin
  select * into v_product from public.products where in_stock and price > 0 order by created_at limit 1;
  if not found then
    raise notice 'Self-test skipped: no in-stock product with a price exists yet.';
    return;
  end if;

  begin
    v_created := public.create_checkout_order(
      jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'size', v_product.sizes[1], 'quantity', 2)),
      jsonb_build_object('full_name', 'Self Test', 'phone', '9876543210', 'email', 'selftest@example.com',
                         'address', '1 Test Street', 'city', 'Hyderabad', 'state', 'Telangana',
                         'pincode', '500001', 'country', 'India'),
      null, 0);
    perform public.attach_razorpay_order((v_created->>'order_id')::uuid, 'order_selftest');

    v_paid := public.mark_order_paid('order_selftest', 'pay_selftest', round((v_created->>'total_amount')::numeric * 100)::bigint, 'upi', '{}'::jsonb, true);
    if v_paid->>'result' <> 'ok' or (v_paid->>'transitioned')::boolean is not true then
      raise exception 'selftest failed: mark_order_paid returned %', v_paid;
    end if;
    v_again := public.mark_order_paid('order_selftest', 'pay_selftest', round((v_created->>'total_amount')::numeric * 100)::bigint, 'upi', '{}'::jsonb, false);
    if (v_again->>'transitioned')::boolean is not false then
      raise exception 'selftest failed: second mark_order_paid should not transition';
    end if;

    select * into v_order from public.orders where id = (v_created->>'order_id')::uuid;
    if v_order.payment_status <> 'paid' or v_order.status <> 'confirmed' then
      raise exception 'selftest failed: order not marked paid/confirmed (% / %)', v_order.payment_status, v_order.status;
    end if;
    if not public.claim_confirmation_email(v_order.id, false) or public.claim_confirmation_email(v_order.id, false) then
      raise exception 'selftest failed: email claim should succeed exactly once';
    end if;
    perform public.record_refund('pay_selftest', 'rfnd_selftest', round((v_created->>'total_amount')::numeric * 100)::bigint, 'processed', '{}'::jsonb);
    if (select payment_status from public.orders where id = v_order.id) <> 'refunded' then
      raise exception 'selftest failed: refund not applied';
    end if;

    raise exception 'selftest_ok';
  exception when others then
    if sqlerrm <> 'selftest_ok' then
      raise;
    end if;
  end;

  -- The fake order used up an order number; hand it back while no real order exists.
  if not exists (select 1 from public.orders where order_number is not null) then
    perform setval('public.order_number_seq', 1001, false);
  end if;
  raise notice 'Self-test passed: order creation, payment, refund and email claim all work.';
end $$;
