// Shiprocket REST calls (courier rates, creating shipments). No dependencies.
// Auth: an API user (Shiprocket → Settings → API → Configure) logs in for a token
// that lasts 10 days. The token is kept in memory and renewed on expiry or a 401.
const API = 'https://apiv2.shiprocket.in/v1/external';
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000; // a day short of Shiprocket's 10

// Default parcel for one item; weight scales with quantity. Adjustable per order in Shiprocket.
export const ITEM_WEIGHT_KG = 0.1;
export const BOX_CM = { length: 10, breadth: 10, height: 5 };

export class ShiprocketError extends Error {
  constructor(status, body) {
    super(body?.message || (body?.errors ? JSON.stringify(body.errors) : '') || `Shiprocket error ${status}`);
    this.status = status;
  }
}

export const isShiprocketConfigured = (env) => !!(env.SHIPROCKET_EMAIL && env.SHIPROCKET_PASSWORD && env.SHIPROCKET_PICKUP_PINCODE);

let cachedToken = null; // { value, expiresAt } — per Worker instance

async function request(method, path, { token, body, query } = {}) {
  const url = new URL(`${API}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) throw new ShiprocketError(res.status, data);
  return data;
}

async function getToken(env, { fresh = false } = {}) {
  if (!fresh && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const data = await request('POST', '/auth/login', { body: { email: env.SHIPROCKET_EMAIL, password: env.SHIPROCKET_PASSWORD } });
  if (!data?.token) throw new ShiprocketError(401, { message: 'Shiprocket login returned no token' });
  cachedToken = { value: data.token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return cachedToken.value;
}

async function call(env, method, path, options = {}) {
  try {
    return await request(method, path, { ...options, token: await getToken(env) });
  } catch (err) {
    if (!(err instanceof ShiprocketError) || err.status !== 401) throw err;
    return request(method, path, { ...options, token: await getToken(env, { fresh: true }) });
  }
}

export const parcelWeightKg = (quantity) => Math.round(Math.max(1, quantity) * ITEM_WEIGHT_KG * 1000) / 1000;

// Cheapest prepaid courier to a pincode, or null when no courier serves it.
export async function cheapestRate(env, { pincode, weightKg }) {
  let data;
  try {
    data = await call(env, 'GET', '/courier/serviceability/', {
      query: { pickup_postcode: env.SHIPROCKET_PICKUP_PINCODE, delivery_postcode: pincode, weight: weightKg, cod: 0 },
    });
  } catch (err) {
    // Shiprocket answers 404 when nothing serves the pincode.
    if (err instanceof ShiprocketError && err.status === 404) return null;
    throw err;
  }
  const couriers = (data?.data?.available_courier_companies || [])
    .map((c) => ({ ...c, charge: Number(c.freight_charge ?? c.rate) }))
    .filter((c) => Number.isFinite(c.charge) && c.charge > 0);
  if (!couriers.length) return null;
  const best = couriers.reduce((a, b) => (b.charge < a.charge ? b : a));
  return {
    fee: Math.ceil(best.charge),
    courier: best.courier_name || '',
    days: best.estimated_delivery_days || '',
    etd: best.etd || '',
  };
}

const istDateTime = (iso) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(iso ? new Date(iso) : new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};

// Creates the Shiprocket order for a paid order bundle (see get_order_bundle).
export async function createShiprocketOrder(env, { order, items }) {
  const d = order.shipping_details || {};
  const [first, ...rest] = String(d.full_name || '').trim().split(/\s+/);
  const quantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const itemsTotal = items.reduce((sum, item) => sum + Number(item.unit_price) * Number(item.quantity), 0);

  const data = await call(env, 'POST', '/orders/create/adhoc', {
    body: {
      order_id: order.order_number,
      order_date: istDateTime(order.paid_at || order.created_at),
      pickup_location: env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
      comment: order.notes || '',
      billing_customer_name: first || 'Customer',
      billing_last_name: rest.join(' '),
      billing_address: d.address,
      billing_city: d.city,
      billing_pincode: d.pincode,
      billing_state: d.state,
      billing_country: d.country || 'India',
      billing_email: d.email,
      billing_phone: d.phone,
      shipping_is_billing: true,
      order_items: items.map((item) => ({
        name: item.size ? `${item.product_name} (${item.size})` : item.product_name,
        sku: `${String(item.product_id || item.id).slice(0, 8)}${item.size ? `-${item.size}` : ''}`.replace(/\s+/g, ''),
        units: Number(item.quantity),
        selling_price: Number(item.unit_price),
      })),
      payment_method: 'Prepaid',
      shipping_charges: Number(order.shipping_fee) || 0,
      // Declared value of the goods = what the customer paid for them (after any promo code).
      sub_total: itemsTotal - (Number(order.discount_amount) || 0),
      length: BOX_CM.length,
      breadth: BOX_CM.breadth,
      height: BOX_CM.height,
      weight: parcelWeightKg(quantity),
    },
  });
  if (!data?.order_id) throw new ShiprocketError(502, { message: `Unexpected Shiprocket response: ${JSON.stringify(data).slice(0, 300)}` });
  return { shiprocketOrderId: String(data.order_id), shipmentId: data.shipment_id ? String(data.shipment_id) : null };
}

export const trackingUrl = (awb) => (awb ? `https://shiprocket.co/tracking/${encodeURIComponent(awb)}` : '');
