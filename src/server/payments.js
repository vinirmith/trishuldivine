// Checkout + Razorpay endpoints, served by the Worker under /payments/*.
//   POST /payments/quote         cart + discount code -> server-priced totals (no order created)
//   POST /payments/create-order  cart + address -> server-priced order + Razorpay order
//   POST /payments/verify        browser payment result -> signature check -> order paid
//   GET  /payments/status        poll an order by its private token
//   POST /payments/webhook       Razorpay -> us (source of truth for payments and refunds)
//   POST /payments/resend-email  admin only
import { rpc, SupabaseError, getUserFromToken, isAdminUser, isUuid } from './supabase.js';
import {
  createRazorpayOrder, fetchPayment, capturePayment, RazorpayError,
  verifyPaymentSignature, verifyWebhookSignature, sha256Hex,
} from './razorpay.js';
import { buildCustomerEmail, buildAdminEmail, sendEmail } from './email.js';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const REQUIRED = ['SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];
const assertConfigured = (env, keys = REQUIRED) => {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) {
    console.error(`Payments not configured, missing: ${missing.join(', ')}`);
    throw new HttpError(503, 'not_configured', 'Online payments are not available right now. Please try again later.');
  }
};

async function readJson(request, maxChars = 20000) {
  const text = await request.text();
  if (text.length > maxChars) throw new HttpError(413, 'too_large', 'Request too large.');
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') throw new Error('not an object');
    return data;
  } catch {
    throw new HttpError(400, 'bad_request', 'Invalid request.');
  }
}

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function parseItems(body) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) throw new HttpError(400, 'empty_cart', 'Your cart is empty.');
  if (rawItems.length > 30) throw new HttpError(400, 'too_many_items', 'Too many items in the cart.');

  const merged = new Map();
  for (const item of rawItems) {
    const productId = String(item?.product_id || '');
    const quantity = Number(item?.quantity);
    if (!isUuid(productId) || !Number.isInteger(quantity) || quantity < 1) {
      throw new HttpError(400, 'invalid_item', 'An item in your cart is invalid. Please remove it and add it again.');
    }
    const size = clean(item?.size, 40);
    const key = `${productId}|${size}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += quantity;
    else merged.set(key, { product_id: productId, size, quantity });
  }
  const items = [...merged.values()];
  if (items.some((item) => item.quantity > 20)) {
    throw new HttpError(400, 'invalid_item', 'You can order at most 20 of one item at a time.');
  }
  return items;
}

const parseDiscountCode = (body) => clean(body.discount_code, 40).toUpperCase();

export function parseCheckout(body) {
  const items = parseItems(body);
  const c = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const bad = (message) => { throw new HttpError(400, 'invalid_customer', message); };

  const full_name = clean(c.full_name, 100);
  if (full_name.length < 2) bad('Please enter your full name.');

  let digits = String(c.phone ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) bad('Please enter a valid 10-digit mobile number.');

  const email = clean(c.email, 120).toLowerCase();
  if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/.test(email)) bad('Please enter a valid email address.');

  const country = clean(c.country || 'India', 60);
  if (!/^india$/i.test(country)) bad('We currently deliver within India only.');

  const address = clean(c.address, 300);
  if (address.length < 5) bad('Please enter your full delivery address.');
  const city = clean(c.city, 60);
  if (city.length < 2) bad('Please enter your city.');
  const state = clean(c.state, 60);
  if (state.length < 2) bad('Please enter your state.');
  const pincode = clean(c.pincode, 10);
  if (!/^[1-9]\d{5}$/.test(pincode)) bad('Please enter a valid 6-digit pincode.');

  return {
    items,
    discountCode: parseDiscountCode(body),
    customer: {
      full_name, phone: digits, email, address, city, state, pincode, country: 'India',
      notes: clean(c.notes, 500),
    },
  };
}

const CHECKOUT_ERRORS = {
  empty_cart: [400, () => 'Your cart is empty.'],
  too_many_items: [400, () => 'Too many items in the cart.'],
  invalid_item: [400, () => 'An item in your cart is invalid. Please remove it and add it again.'],
  invalid_customer: [400, () => 'Please fill in all delivery details.'],
  product_not_found: [409, () => 'An item in your cart is no longer available. Please review your cart.'],
  out_of_stock: [409, (name) => `${name || 'An item in your cart'} is out of stock. Please remove it to continue.`],
  invalid_size: [409, (name) => `Please choose a valid size for ${name || 'an item in your cart'}.`],
  invalid_price: [409, (name) => `${name || 'An item'} is not available for purchase right now.`],
  invalid_discount: [409, () => 'This promo code is not valid or has expired.'],
  discount_min_order: [409, (min) => `This promo code needs a minimum order of ₹${Number(min || 0).toLocaleString('en-IN')}.`],
};

const checkoutRpc = async (env, fn, params) => {
  try {
    return await rpc(env, fn, params);
  } catch (err) {
    const mapped = err instanceof SupabaseError ? CHECKOUT_ERRORS[err.message] : null;
    if (mapped) throw new HttpError(mapped[0], err.message, mapped[1](err.details));
    throw err;
  }
};

const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return /^Bearer\s+\S+$/i.test(header) ? header.split(/\s+/)[1] : '';
};

// ---------------------------------------------------------------------------
async function quote(request, env) {
  assertConfigured(env, ['SUPABASE_SERVICE_ROLE_KEY']);
  const body = await readJson(request);
  const priced = await checkoutRpc(env, 'price_checkout', {
    p_items: parseItems(body), p_discount_code: parseDiscountCode(body) || null,
  });
  return json({
    items: priced.items,
    subtotal: priced.subtotal,
    discount_code: priced.discount_code,
    discount_amount: priced.discount_amount,
    total_amount: priced.total,
  });
}

async function createOrder(request, env) {
  assertConfigured(env);
  const { items, customer, discountCode } = parseCheckout(await readJson(request));

  let userId = null;
  const token = bearerToken(request);
  if (token) {
    try { userId = (await getUserFromToken(env, token))?.id || null; } catch (err) { console.warn('token lookup failed', err.message); }
  }

  const created = await checkoutRpc(env, 'create_checkout_order', {
    p_items: items, p_customer: customer, p_user_id: userId, p_shipping_fee: 0,
    p_discount_code: discountCode || null,
  });

  const amount = Math.round(Number(created.total_amount) * 100);
  if (!Number.isInteger(amount) || amount < 100) {
    console.error('Refusing to create a Razorpay order for amount', created.total_amount, created.order_number);
    throw new HttpError(409, 'invalid_amount', 'This order cannot be paid online. Please contact us.');
  }

  let razorpayOrder;
  try {
    razorpayOrder = await createRazorpayOrder(env, {
      amount,
      receipt: created.order_number,
      notes: { order_number: created.order_number, order_id: created.order_id },
    });
  } catch (err) {
    console.error('Razorpay order creation failed for', created.order_number, err.message);
    throw new HttpError(502, 'payment_unavailable', 'We could not start the payment. Please try again in a moment.');
  }
  if (!razorpayOrder?.id || Number(razorpayOrder.amount) !== amount) {
    console.error('Unexpected Razorpay order response', created.order_number, JSON.stringify(razorpayOrder));
    throw new HttpError(502, 'payment_unavailable', 'We could not start the payment. Please try again in a moment.');
  }

  await rpc(env, 'attach_razorpay_order', { p_order_id: created.order_id, p_razorpay_order_id: razorpayOrder.id });

  return json({
    key_id: env.RAZORPAY_KEY_ID,
    razorpay_order_id: razorpayOrder.id,
    amount,
    currency: 'INR',
    order_number: created.order_number,
    public_token: created.public_token,
    subtotal: created.subtotal,
    discount_code: created.discount_code,
    discount_amount: created.discount_amount,
    total_amount: created.total_amount,
    description: `Order ${created.order_number}`,
    prefill: { name: customer.full_name, email: customer.email, contact: `+91${customer.phone}` },
  });
}

// ---------------------------------------------------------------------------
const markPaid = (env, { razorpayOrderId, paymentId, amountPaise, method, payload, signatureVerified }) =>
  rpc(env, 'mark_order_paid', {
    p_razorpay_order_id: razorpayOrderId,
    p_payment_id: paymentId,
    p_amount_paise: amountPaise ?? null,
    p_method: method ?? null,
    p_payload: payload ?? null,
    p_signature_verified: !!signatureVerified,
  });

async function verifyPayment(request, env, ctx) {
  assertConfigured(env);
  const body = await readJson(request);
  const orderId = String(body.razorpay_order_id || '');
  const paymentId = String(body.razorpay_payment_id || '');
  const signature = String(body.razorpay_signature || '');
  if (!/^order_[A-Za-z0-9]{6,40}$/.test(orderId) || !/^pay_[A-Za-z0-9]{6,40}$/.test(paymentId) || !/^[a-f0-9]{64}$/i.test(signature)) {
    throw new HttpError(400, 'bad_request', 'Invalid payment details.');
  }
  if (!(await verifyPaymentSignature(env, orderId, paymentId, signature))) {
    console.error('Invalid payment signature for', orderId, paymentId);
    throw new HttpError(400, 'invalid_signature', 'We could not verify this payment.');
  }

  const bundle = await rpc(env, 'get_order_bundle', { p_razorpay_order_id: orderId });
  if (!bundle) throw new HttpError(404, 'order_not_found', 'Order not found.');
  const order = bundle.order;

  // The signature already proves Razorpay took this payment for this order. Fetching
  // the payment lets us also capture it if the account is on manual capture.
  let payment = null;
  try { payment = await fetchPayment(env, paymentId); } catch (err) { console.warn('Could not fetch payment', paymentId, err.message); }

  if (payment) {
    if (payment.order_id !== orderId) throw new HttpError(400, 'invalid_payment', 'This payment does not belong to the order.');
    if (payment.status === 'failed') throw new HttpError(402, 'payment_failed', 'The payment did not go through.');
    if (payment.status === 'authorized') {
      try {
        payment = await capturePayment(env, paymentId, payment.amount);
      } catch (err) {
        console.error('Capture failed for', paymentId, err.message);
        return json({ ok: false, status: 'processing', order_number: order.order_number }, 202);
      }
    }
    if (payment.status !== 'captured' && payment.status !== 'refunded') {
      return json({ ok: false, status: 'processing', order_number: order.order_number }, 202);
    }
  }

  const result = await markPaid(env, {
    razorpayOrderId: orderId,
    paymentId,
    amountPaise: payment ? payment.amount : null,
    method: payment?.method,
    payload: payment,
    signatureVerified: true,
  });
  if (result.result === 'order_not_found') throw new HttpError(404, 'order_not_found', 'Order not found.');
  if (result.result === 'amount_mismatch') {
    console.error('Amount mismatch on verify', orderId, paymentId);
    throw new HttpError(409, 'amount_mismatch', `We received a payment that does not match order ${result.order_number}. Please contact us with this order number.`);
  }

  ctx.waitUntil(sendOrderEmails(env, result.order_id).catch((err) => console.error('Order email failed', result.order_number, err.message)));
  return json({ ok: true, status: 'paid', order_number: result.order_number });
}

async function orderStatus(url, env) {
  assertConfigured(env, ['SUPABASE_SERVICE_ROLE_KEY']);
  const token = url.searchParams.get('token') || '';
  if (!isUuid(token)) throw new HttpError(400, 'bad_request', 'Invalid token.');
  const bundle = await rpc(env, 'get_order_bundle', { p_public_token: token });
  if (!bundle) throw new HttpError(404, 'order_not_found', 'Order not found.');
  return json({ order_number: bundle.order.order_number, payment_status: bundle.order.payment_status });
}

// ---------------------------------------------------------------------------
// Emails: the claim in the database guarantees one send per order, however many
// times verify / webhook / retries call this.
export async function sendOrderEmails(env, orderId, { force = false } = {}) {
  const claimed = await rpc(env, 'claim_confirmation_email', { p_order_id: orderId, p_force: force });
  if (!claimed) return { skipped: true };

  const bundle = await rpc(env, 'get_order_bundle', { p_order_id: orderId });
  let customerError = null;
  try {
    const message = buildCustomerEmail(env, bundle);
    await sendEmail(env, {
      to: bundle.order.shipping_details.email,
      ...message,
      idempotencyKey: force ? `order-confirmation-${orderId}-${Date.now()}` : `order-confirmation-${orderId}`,
    });
    await rpc(env, 'finish_confirmation_email', { p_order_id: orderId, p_ok: true });
  } catch (err) {
    customerError = err;
    console.error('Customer email failed for', bundle.order.order_number, err.message);
    await rpc(env, 'finish_confirmation_email', { p_order_id: orderId, p_ok: false, p_error: err.message }).catch(() => {});
  }

  if (!force) {
    const admins = String(env.ADMIN_NOTIFY_EMAIL || '').split(',').map((e) => e.trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (admins.length) {
      try {
        await sendEmail(env, { to: admins, ...buildAdminEmail(env, bundle), idempotencyKey: `admin-new-order-${orderId}` });
      } catch (err) {
        console.error('Admin notification failed for', bundle.order.order_number, err.message);
      }
    }
  }

  if (customerError) throw customerError;
  return { sent: true };
}

async function resendEmail(request, env) {
  assertConfigured(env, ['SUPABASE_SERVICE_ROLE_KEY']);
  const user = await getUserFromToken(env, bearerToken(request));
  if (!user) throw new HttpError(401, 'unauthorized', 'Please log in again.');
  if (!(await isAdminUser(env, user.id))) throw new HttpError(403, 'forbidden', 'Admins only.');

  const body = await readJson(request);
  if (!isUuid(body.order_id)) throw new HttpError(400, 'bad_request', 'Invalid order.');
  const bundle = await rpc(env, 'get_order_bundle', { p_order_id: body.order_id });
  if (!bundle) throw new HttpError(404, 'order_not_found', 'Order not found.');
  if (!['paid', 'partially_refunded', 'refunded'].includes(bundle.order.payment_status)) {
    throw new HttpError(409, 'not_paid', 'Only paid orders have a confirmation email.');
  }
  try {
    const result = await sendOrderEmails(env, body.order_id, { force: true });
    if (result.skipped) throw new HttpError(409, 'in_progress', 'An email is already being sent for this order. Try again in a minute.');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'email_failed', `Email failed: ${err.message}`);
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
const entity = (event, key) => event?.payload?.[key]?.entity;

async function processWebhookEvent(env, ctx, type, event) {
  switch (type) {
    case 'payment.captured':
    case 'order.paid': {
      const p = entity(event, 'payment');
      if (!p?.id || !p.order_id) return { status: 'ignored', error: 'no payment in payload' };
      const result = await markPaid(env, {
        razorpayOrderId: p.order_id, paymentId: p.id, amountPaise: p.amount,
        method: p.method, payload: p, signatureVerified: true,
      });
      if (result.result === 'order_not_found') return { status: 'ignored', error: 'order not found' };
      if (result.result === 'amount_mismatch') {
        console.error('Amount mismatch from webhook', p.order_id, p.id, p.amount);
        return { status: 'failed', error: 'amount_mismatch' };
      }
      // Also covers an order that was paid in the browser but whose email never went out.
      ctx.waitUntil(sendOrderEmails(env, result.order_id).catch((err) => console.error('Order email failed', result.order_number, err.message)));
      return { status: 'processed' };
    }

    case 'payment.authorized': {
      const p = entity(event, 'payment');
      if (!p?.id || !p.order_id) return { status: 'ignored', error: 'no payment in payload' };
      const bundle = await rpc(env, 'get_order_bundle', { p_razorpay_order_id: p.order_id });
      if (!bundle) return { status: 'ignored', error: 'order not found' };
      if (Math.round(Number(bundle.order.total_amount) * 100) !== Number(p.amount)) {
        return { status: 'failed', error: 'amount_mismatch' };
      }
      try {
        await capturePayment(env, p.id, p.amount);
      } catch (err) {
        if (!(err instanceof RazorpayError && /already.*captur/i.test(err.message))) throw err;
      }
      return { status: 'processed' };
    }

    case 'payment.failed': {
      const p = entity(event, 'payment');
      if (!p?.id || !p.order_id) return { status: 'ignored', error: 'no payment in payload' };
      const result = await rpc(env, 'record_payment_failure', {
        p_razorpay_order_id: p.order_id, p_payment_id: p.id, p_amount_paise: p.amount ?? null,
        p_method: p.method ?? null, p_error_code: p.error_code ?? null,
        p_error_description: p.error_description ?? null, p_payload: p,
      });
      return result.result === 'order_not_found' ? { status: 'ignored', error: 'order not found' } : { status: 'processed' };
    }

    case 'refund.processed': {
      const r = entity(event, 'refund');
      if (!r?.id || !r.payment_id) return { status: 'ignored', error: 'no refund in payload' };
      const result = await rpc(env, 'record_refund', {
        p_razorpay_payment_id: r.payment_id, p_refund_id: r.id, p_amount_paise: r.amount ?? 0,
        p_status: 'processed', p_payload: r,
      });
      return result.result === 'payment_not_found' ? { status: 'ignored', error: 'payment not found' } : { status: 'processed' };
    }

    default:
      return { status: 'ignored', error: `unhandled event ${type}` };
  }
}

async function webhook(request, env, ctx) {
  assertConfigured(env, ['SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']);
  const raw = await request.text();
  if (!(await verifyWebhookSignature(env, raw, request.headers.get('x-razorpay-signature')))) {
    console.error('Webhook with invalid signature rejected');
    throw new HttpError(400, 'invalid_signature', 'Invalid signature.');
  }

  let event;
  try { event = JSON.parse(raw); } catch { throw new HttpError(400, 'bad_request', 'Invalid JSON.'); }
  const type = String(event?.event || '');
  const eventId = request.headers.get('x-razorpay-event-id') || await sha256Hex(raw);

  const seen = await rpc(env, 'begin_webhook_event', { p_source: 'razorpay', p_event_id: eventId, p_event_type: type, p_payload: event });
  if (seen === 'processed' || seen === 'ignored') return json({ ok: true, duplicate: true });

  let outcome;
  try {
    outcome = await processWebhookEvent(env, ctx, type, event);
  } catch (err) {
    console.error('Webhook processing failed', type, eventId, err.message);
    await rpc(env, 'finish_webhook_event', { p_source: 'razorpay', p_event_id: eventId, p_status: 'failed', p_error: String(err.message).slice(0, 500) }).catch(() => {});
    throw err; // 500 -> Razorpay retries this event later
  }
  await rpc(env, 'finish_webhook_event', { p_source: 'razorpay', p_event_id: eventId, p_status: outcome.status, p_error: outcome.error ?? null });
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
export async function handlePayments(request, env, ctx) {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname.replace(/\/+$/, '')}`;
  try {
    switch (route) {
      case 'POST /payments/quote': return await quote(request, env);
      case 'POST /payments/create-order': return await createOrder(request, env);
      case 'POST /payments/verify': return await verifyPayment(request, env, ctx);
      case 'GET /payments/status': return await orderStatus(url, env);
      case 'POST /payments/webhook': return await webhook(request, env, ctx);
      case 'POST /payments/resend-email': return await resendEmail(request, env);
      default: return json({ error: 'not_found' }, 404);
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code, message: err.message }, err.status);
    console.error('Unhandled payments error', route, err?.stack || err);
    return json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, 500);
  }
}
