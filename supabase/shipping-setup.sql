-- Trishul Divine — shipping with Shiprocket
-- Run in the Supabase SQL editor AFTER payments-setup.sql. Safe to re-run.
--
-- What this does
--   * Adds shipping columns to orders: the Shiprocket push state (is the paid order in
--     Shiprocket yet?) and the tracking state that Shiprocket's webhook reports.
--   * Server-only functions so a paid order is sent to Shiprocket exactly once, tracking
--     updates are applied safely, and the "shipped" email goes out at most once.
--   * Ends with a self-test that runs a fake order through shipping and rolls it back.

do $$
begin
  if to_regprocedure('public.mark_order_paid(text, text, bigint, text, jsonb, boolean)') is null then
    raise exception 'Run supabase/payments-setup.sql first.';
  end if;
end $$;

alter table public.orders
  add column if not exists shiprocket_push_status text not null default 'pending',
  add column if not exists shiprocket_claimed_at timestamptz,
  add column if not exists shiprocket_error text,
  add column if not exists shiprocket_order_id text,
  add column if not exists shiprocket_shipment_id text,
  add column if not exists awb_code text,
  add column if not exists courier_name text,
  add column if not exists tracking_status text,
  add column if not exists tracking_updated_at timestamptz,
  add column if not exists expected_delivery text,
  add column if not exists shipped_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists shipped_email_sent_at timestamptz;

alter table public.orders drop constraint if exists orders_shiprocket_push_status_check;
alter table public.orders add constraint orders_shiprocket_push_status_check
  check (shiprocket_push_status in ('pending', 'sending', 'sent', 'failed'));

create index if not exists orders_shiprocket_order_id_idx on public.orders (shiprocket_order_id);

-- Makes sure only one request sends a paid order to Shiprocket (a duplicate there
-- would mean two parcels). A stuck 'sending' claim can be retaken after 5 minutes.
create or replace function public.claim_shiprocket_push(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.orders
  set shiprocket_push_status = 'sending', shiprocket_claimed_at = now(), shiprocket_error = null
  where id = p_order_id
    and payment_status = 'paid'
    and (
      shiprocket_push_status in ('pending', 'failed')
      or (shiprocket_push_status = 'sending' and shiprocket_claimed_at < now() - interval '5 minutes')
    );
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.finish_shiprocket_push(
  p_order_id uuid,
  p_ok boolean,
  p_shiprocket_order_id text default null,
  p_shipment_id text default null,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders
  set shiprocket_push_status = case when p_ok then 'sent' else 'failed' end,
      shiprocket_order_id = coalesce(p_shiprocket_order_id, shiprocket_order_id),
      shiprocket_shipment_id = coalesce(p_shipment_id, shiprocket_shipment_id),
      shiprocket_error = case when p_ok then null else left(coalesce(p_error, 'unknown error'), 500) end
  where id = p_order_id;
$$;

-- Applies one tracking update from Shiprocket's webhook. Matches the order by
-- Shiprocket's id first, then by our order number. Reports whether this update is
-- the one that first marks the order shipped (so the shipped email goes out once).
create or replace function public.record_shipment_update(
  p_shiprocket_order_id text,
  p_order_number text,
  p_awb text,
  p_courier text,
  p_status text,
  p_etd text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_moving boolean;
  v_newly_shipped boolean := false;
  v_newly_delivered boolean := false;
begin
  select * into v_order from public.orders
  where (nullif(p_shiprocket_order_id, '') is not null and shiprocket_order_id = p_shiprocket_order_id)
     or (nullif(p_order_number, '') is not null and order_number = p_order_number)
  order by (shiprocket_order_id = p_shiprocket_order_id) desc nulls last
  limit 1
  for update;
  if not found then
    return jsonb_build_object('result', 'order_not_found');
  end if;

  -- Statuses that mean the parcel has left with the courier.
  v_moving := v_status ~ '(PICKED UP|SHIPPED|IN TRANSIT|OUT FOR DELIVERY|REACHED|DELIVERED)';

  update public.orders
  set awb_code = coalesce(nullif(btrim(p_awb), ''), awb_code),
      courier_name = coalesce(nullif(btrim(p_courier), ''), courier_name),
      tracking_status = coalesce(nullif(v_status, ''), tracking_status),
      tracking_updated_at = now(),
      expected_delivery = coalesce(nullif(btrim(p_etd), ''), expected_delivery),
      shipped_at = case when v_moving and shipped_at is null then now() else shipped_at end,
      delivered_at = case when v_status = 'DELIVERED' and delivered_at is null then now() else delivered_at end,
      status = case
        when v_status = 'DELIVERED' then 'delivered'
        when v_moving and status in ('pending', 'confirmed') then 'shipped'
        else status
      end
  where id = v_order.id;

  v_newly_shipped := v_moving and v_order.shipped_at is null;
  v_newly_delivered := v_status = 'DELIVERED' and v_order.delivered_at is null;

  return jsonb_build_object(
    'result', 'ok',
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'newly_shipped', v_newly_shipped,
    'newly_delivered', v_newly_delivered
  );
end;
$$;

-- The "your order has shipped" email: claim before sending, release if sending fails.
create or replace function public.claim_shipped_email(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.orders set shipped_email_sent_at = now()
  where id = p_order_id and shipped_email_sent_at is null and awb_code is not null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.release_shipped_email(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders set shipped_email_sent_at = null where id = p_order_id;
$$;

revoke all on function public.claim_shiprocket_push(uuid) from public, anon, authenticated;
revoke all on function public.finish_shiprocket_push(uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.record_shipment_update(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_shipped_email(uuid) from public, anon, authenticated;
revoke all on function public.release_shipped_email(uuid) from public, anon, authenticated;

grant execute on function public.claim_shiprocket_push(uuid) to service_role;
grant execute on function public.finish_shiprocket_push(uuid, boolean, text, text, text) to service_role;
grant execute on function public.record_shipment_update(text, text, text, text, text, text) to service_role;
grant execute on function public.claim_shipped_email(uuid) to service_role;
grant execute on function public.release_shipped_email(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Self-test: a fake paid order goes through push, tracking and delivery, then is
-- rolled back. If this block raises an error, send it to me before going live.
-- ---------------------------------------------------------------------------
do $$
declare
  v_product public.products%rowtype;
  v_created jsonb;
  v_id uuid;
  v_update jsonb;
  v_order public.orders%rowtype;
begin
  select * into v_product from public.products where in_stock and price > 0 order by created_at limit 1;
  if not found then
    raise notice 'Shipping self-test skipped: no in-stock product with a price exists yet.';
    return;
  end if;

  begin
    v_created := public.create_checkout_order(
      jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'size', v_product.sizes[1], 'quantity', 1)),
      jsonb_build_object('full_name', 'Ship Test', 'phone', '9876543210', 'email', 'shiptest@example.com',
                         'address', '1 Test Street', 'city', 'Hyderabad', 'state', 'Telangana',
                         'pincode', '500001', 'country', 'India'),
      null, 60, null);
    v_id := (v_created->>'order_id')::uuid;

    if public.claim_shiprocket_push(v_id) then
      raise exception 'shipping selftest failed: an unpaid order must not be sent to Shiprocket';
    end if;
    perform public.attach_razorpay_order(v_id, 'order_shiptest');
    perform public.mark_order_paid('order_shiptest', 'pay_shiptest', round((v_created->>'total_amount')::numeric * 100)::bigint, 'upi', '{}'::jsonb, true);

    if not public.claim_shiprocket_push(v_id) or public.claim_shiprocket_push(v_id) then
      raise exception 'shipping selftest failed: push claim should succeed exactly once';
    end if;
    perform public.finish_shiprocket_push(v_id, true, 'SR123', 'SH456', null);

    v_update := public.record_shipment_update('SR123', null, null, null, 'AWB ASSIGNED', null);
    if (v_update->>'newly_shipped')::boolean then
      raise exception 'shipping selftest failed: AWB assigned is not shipped yet';
    end if;
    if public.claim_shipped_email(v_id) then
      raise exception 'shipping selftest failed: no shipped email without an AWB';
    end if;

    v_update := public.record_shipment_update('SR123', null, '1904142475', 'Delhivery Surface', 'IN TRANSIT', '2026-11-02 15:40:19');
    if not (v_update->>'newly_shipped')::boolean then
      raise exception 'shipping selftest failed: in transit should mark shipped (%)', v_update;
    end if;
    v_update := public.record_shipment_update(null, v_created->>'order_number', null, null, 'OUT FOR DELIVERY', null);
    if (v_update->>'newly_shipped')::boolean then
      raise exception 'shipping selftest failed: shipped should be reported only once';
    end if;
    if not public.claim_shipped_email(v_id) or public.claim_shipped_email(v_id) then
      raise exception 'shipping selftest failed: shipped email claim should succeed exactly once';
    end if;

    v_update := public.record_shipment_update('SR123', null, null, null, 'DELIVERED', null);
    select * into v_order from public.orders where id = v_id;
    if not (v_update->>'newly_delivered')::boolean or v_order.status <> 'delivered' or v_order.delivered_at is null
       or v_order.awb_code <> '1904142475' or v_order.shipping_fee <> 60 then
      raise exception 'shipping selftest failed: delivery not recorded (% / %)', v_order.status, v_update;
    end if;

    raise exception 'shipping_selftest_ok';
  exception when others then
    if sqlerrm <> 'shipping_selftest_ok' then
      raise;
    end if;
  end;
  raise notice 'Shipping self-test passed: push, tracking, shipped email and delivery all work.';
end $$;
