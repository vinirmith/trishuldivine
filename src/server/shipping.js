// Shipping with Shiprocket, served by the Worker under /shipping/*.
//   POST /shipping/webhook  Shiprocket tracking updates -> order status, AWB, shipped email
//   POST /shipping/push     admin only: (re)send a paid order to Shiprocket
// Paid orders are also pushed automatically from payments.js once payment is confirmed.
import { rpc, getUserFromToken, isAdminUser, isUuid } from './supabase.js';
import { isShiprocketConfigured, cheapestRate, parcelWeightKg, createShiprocketOrder, trackingUrl } from './shiprocket.js';
import { buildShippedEmail, sendEmail } from './email.js';
import { sha256Hex, safeEqual } from './razorpay.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export class ShippingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Shipping fee for a cart going to a pincode: the cheapest Shiprocket courier rate.
// Free while Shiprocket is not set up, so checkout keeps working.
export async function shippingQuote(env, { items, pincode }) {
  if (!isShiprocketConfigured(env)) return { shipping_fee: 0, courier: '', estimated_days: '' };
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  let rate;
  try {
    rate = await cheapestRate(env, { pincode, weightKg: parcelWeightKg(quantity) });
  } catch (err) {
    console.error('Shiprocket rate lookup failed', pincode, err.message);
    throw new ShippingError(503, 'shipping_unavailable', 'We could not work out delivery charges right now. Please try again in a moment.');
  }
  if (!rate) throw new ShippingError(409, 'not_serviceable', `Sorry, we cannot deliver to pincode ${pincode} yet. Please check the pincode or contact us on WhatsApp.`);
  return { shipping_fee: rate.fee, courier: rate.courier, estimated_days: String(rate.days || '') };
}

// Sends a paid order to Shiprocket once. Safe to call any number of times.
export async function pushOrderToShiprocket(env, orderId) {
  if (!isShiprocketConfigured(env)) return { skipped: 'not_configured' };
  const claimed = await rpc(env, 'claim_shiprocket_push', { p_order_id: orderId });
  if (!claimed) return { skipped: 'already_sent_or_not_paid' };

  const bundle = await rpc(env, 'get_order_bundle', { p_order_id: orderId });
  try {
    const created = await createShiprocketOrder(env, bundle);
    await rpc(env, 'finish_shiprocket_push', {
      p_order_id: orderId, p_ok: true, p_shiprocket_order_id: created.shiprocketOrderId, p_shipment_id: created.shipmentId,
    });
    return { sent: true, ...created };
  } catch (err) {
    console.error('Shiprocket push failed for', bundle.order.order_number, err.message);
    await rpc(env, 'finish_shiprocket_push', { p_order_id: orderId, p_ok: false, p_error: err.message }).catch(() => {});
    throw err;
  }
}

async function sendShippedEmail(env, orderId) {
  const claimed = await rpc(env, 'claim_shipped_email', { p_order_id: orderId });
  if (!claimed) return;
  const bundle = await rpc(env, 'get_order_bundle', { p_order_id: orderId });
  try {
    await sendEmail(env, {
      to: bundle.order.shipping_details.email,
      ...buildShippedEmail(env, bundle, trackingUrl(bundle.order.awb_code)),
      idempotencyKey: `order-shipped-${orderId}`,
    });
  } catch (err) {
    await rpc(env, 'release_shipped_email', { p_order_id: orderId }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
async function webhook(request, env, ctx) {
  // Shiprocket sends the token configured in its webhook settings as x-api-key.
  if (!env.SHIPROCKET_WEBHOOK_TOKEN || !safeEqual(request.headers.get('x-api-key') || '', env.SHIPROCKET_WEBHOOK_TOKEN)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 503);

  const raw = await request.text();
  let event;
  try { event = JSON.parse(raw); } catch { return json({ ok: true, ignored: 'invalid json' }); }

  const eventId = await sha256Hex(raw);
  const type = `tracking:${String(event?.current_status || event?.shipment_status || 'unknown').toLowerCase()}`;
  const seen = await rpc(env, 'begin_webhook_event', { p_source: 'shiprocket', p_event_id: eventId, p_event_type: type, p_payload: event });
  if (seen === 'processed' || seen === 'ignored') return json({ ok: true, duplicate: true });

  try {
    const result = await rpc(env, 'record_shipment_update', {
      p_shiprocket_order_id: event.sr_order_id != null ? String(event.sr_order_id) : null,
      p_order_number: event.order_id != null ? String(event.order_id) : null,
      p_awb: event.awb != null ? String(event.awb) : null,
      p_courier: event.courier_name || null,
      p_status: event.current_status || event.shipment_status || null,
      p_etd: event.etd || null,
    });
    if (result.result === 'order_not_found') {
      await rpc(env, 'finish_webhook_event', { p_source: 'shiprocket', p_event_id: eventId, p_status: 'ignored', p_error: 'order not found' });
      return json({ ok: true });
    }
    if (result.newly_shipped) {
      ctx.waitUntil(sendShippedEmail(env, result.order_id).catch((err) => console.error('Shipped email failed', result.order_number, err.message)));
    }
    await rpc(env, 'finish_webhook_event', { p_source: 'shiprocket', p_event_id: eventId, p_status: 'processed' });
    return json({ ok: true });
  } catch (err) {
    console.error('Shiprocket webhook failed', eventId, err.message);
    await rpc(env, 'finish_webhook_event', { p_source: 'shiprocket', p_event_id: eventId, p_status: 'failed', p_error: String(err.message).slice(0, 500) }).catch(() => {});
    return json({ error: 'server_error' }, 500); // Shiprocket retries
  }
}

async function adminPush(request, env) {
  const header = request.headers.get('authorization') || '';
  const user = /^Bearer\s+\S+$/i.test(header) ? await getUserFromToken(env, header.split(/\s+/)[1]) : null;
  if (!user) throw new ShippingError(401, 'unauthorized', 'Please log in again.');
  if (!(await isAdminUser(env, user.id))) throw new ShippingError(403, 'forbidden', 'Admins only.');
  if (!isShiprocketConfigured(env)) throw new ShippingError(503, 'not_configured', 'Shiprocket is not connected yet. Add the Shiprocket secrets in Cloudflare first.');

  let body = {};
  try { body = await request.json(); } catch { /* handled below */ }
  if (!isUuid(body.order_id)) throw new ShippingError(400, 'bad_request', 'Invalid order.');
  try {
    const result = await pushOrderToShiprocket(env, body.order_id);
    if (result.skipped) throw new ShippingError(409, 'not_pushed', 'This order is already in Shiprocket, is being sent right now, or is not paid.');
    return json({ ok: true, shiprocket_order_id: result.shiprocketOrderId });
  } catch (err) {
    if (err instanceof ShippingError) throw err;
    throw new ShippingError(502, 'shiprocket_failed', `Shiprocket refused the order: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
export async function handleShipping(request, env, ctx) {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname.replace(/\/+$/, '')}`;
  try {
    switch (route) {
      case 'POST /shipping/webhook': return await webhook(request, env, ctx);
      case 'POST /shipping/push': return await adminPush(request, env);
      default: return json({ error: 'not_found' }, 404);
    }
  } catch (err) {
    if (err instanceof ShippingError) return json({ error: err.code, message: err.message }, err.status);
    console.error('Unhandled shipping error', route, err?.stack || err);
    return json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, 500);
  }
}
