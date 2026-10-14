// Razorpay REST calls and signature checks (Web Crypto, no dependencies).
const API = 'https://api.razorpay.com/v1';

export class RazorpayError extends Error {
  constructor(status, body) {
    super(body?.error?.description || `Razorpay error ${status}`);
    this.status = status;
    this.code = body?.error?.code;
  }
}

async function call(env, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) throw new RazorpayError(res.status, data);
  return data;
}

export const createRazorpayOrder = (env, { amount, receipt, notes }) =>
  call(env, 'POST', '/orders', { amount, currency: 'INR', receipt, notes });

export const fetchPayment = (env, paymentId) => call(env, 'GET', `/payments/${paymentId}`);

export const capturePayment = (env, paymentId, amount) =>
  call(env, 'POST', `/payments/${paymentId}/capture`, { amount, currency: 'INR' });

const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export async function sha256Hex(message) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message)));
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Checkout success: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
export async function verifyPaymentSignature(env, orderId, paymentId, signature) {
  const expected = await hmacHex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
  return safeEqual(expected, String(signature || '').toLowerCase());
}

// Webhook: HMAC_SHA256(raw request body, webhook_secret)
export async function verifyWebhookSignature(env, rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
  return safeEqual(expected, String(signature).toLowerCase());
}
