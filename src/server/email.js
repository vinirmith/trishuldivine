// Order emails, sent through Resend (https://resend.com).
const BRAND = 'Trishul Divine';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const siteUrl = (env) => String(env.SITE_URL || 'https://trishuldivine.com').replace(/\/+$/, '');
const supportEmail = (env) => env.SUPPORT_EMAIL || 'trishuldivine26@gmail.com';

const money = (value) => {
  const n = Number(value || 0);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
};

const when = (iso) => {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
};

const METHODS = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay later' };
const methodLabel = (method) => METHODS[method] || (method ? String(method) : '');

const imageUrl = (env, src) => {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  return `${siteUrl(env)}/${encodeURI(String(src).replace(/^\/+/, ''))}`;
};

const itemsHtml = (env, items) => items.map((item) => {
  const img = imageUrl(env, item.product_image);
  const size = item.size ? `<div style="color:#61645b;font-size:13px;margin-top:2px;">Size: ${esc(item.size)}</div>` : '';
  return `<tr>
    <td style="padding:12px 0;border-bottom:1px solid #e8e2d5;width:64px;vertical-align:top;">${img ? `<img src="${esc(img)}" width="56" height="56" alt="" style="display:block;border-radius:8px;object-fit:cover;">` : ''}</td>
    <td style="padding:12px 12px;border-bottom:1px solid #e8e2d5;vertical-align:top;font-size:15px;color:#1e201c;">${esc(item.product_name)}${size}<div style="color:#61645b;font-size:13px;margin-top:2px;">Qty ${esc(item.quantity)} × ${money(item.unit_price)}</div></td>
    <td style="padding:12px 0;border-bottom:1px solid #e8e2d5;vertical-align:top;text-align:right;font-size:15px;color:#1e201c;white-space:nowrap;">${money(Number(item.unit_price) * Number(item.quantity))}</td>
  </tr>`;
}).join('');

const itemsText = (items) => items.map((item) =>
  `- ${item.product_name}${item.size ? ` (${item.size})` : ''} x${item.quantity}  ${money(Number(item.unit_price) * Number(item.quantity))}`).join('\n');

const addressLines = (details) => [
  details.full_name,
  details.address,
  `${details.city}, ${details.state} ${details.pincode}`,
  details.country,
  details.phone ? `Phone: ${details.phone}` : '',
].filter(Boolean);

const totalsHtml = (order) => {
  const row = (label, value, strong) => `<tr><td style="padding:4px 0;color:${strong ? '#1e201c' : '#61645b'};font-size:${strong ? 16 : 14}px;${strong ? 'font-weight:600;' : ''}">${label}</td><td style="padding:4px 0;text-align:right;color:#1e201c;font-size:${strong ? 16 : 14}px;${strong ? 'font-weight:600;' : ''}">${value}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
    ${row('Subtotal', money(order.subtotal ?? order.total_amount))}
    ${Number(order.discount_amount) > 0 ? row(`Discount (${esc(order.discount_code)})`, `−${money(order.discount_amount)}`) : ''}
    ${row('Shipping', Number(order.shipping_fee) > 0 ? money(order.shipping_fee) : 'Free')}
    ${row('Total paid', money(order.total_amount), true)}
  </table>`;
};

const shell = (env, title, inner) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f0e7;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0e7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffdf8;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#3d4a39;padding:22px 28px;color:#fffdf8;font-size:18px;letter-spacing:3px;text-transform:uppercase;">${BRAND}</td></tr>
        <tr><td style="padding:28px;">${inner}</td></tr>
        <tr><td style="padding:18px 28px;background:#e8e2d5;color:#61645b;font-size:12px;line-height:1.6;">
          Questions about your order? Reply to this email or write to <a href="mailto:${esc(supportEmail(env))}" style="color:#3d4a39;">${esc(supportEmail(env))}</a>.<br>
          ${BRAND} · <a href="${esc(siteUrl(env))}" style="color:#3d4a39;">${esc(siteUrl(env).replace(/^https?:\/\//, ''))}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

export function buildCustomerEmail(env, bundle) {
  const { order, items, payment } = bundle;
  const details = order.shipping_details || {};
  const first = esc(String(details.full_name || 'there').split(' ')[0]);
  const method = methodLabel(payment?.method);
  const subject = `Order confirmed – ${order.order_number} | ${BRAND}`;

  const html = shell(env, subject, `
    <p style="margin:0 0 6px;color:#ad7655;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Payment received</p>
    <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-weight:normal;font-size:28px;color:#1e201c;">Thank you, ${first}.</h1>
    <p style="margin:0 0 20px;color:#61645b;font-size:15px;line-height:1.7;">Your order is confirmed and we are getting it ready. We will email you again with tracking details as soon as it ships.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0e7;border-radius:10px;margin-bottom:22px;">
      <tr><td style="padding:14px 16px;font-size:14px;color:#61645b;">Order number<br><strong style="font-size:18px;color:#1e201c;">${esc(order.order_number)}</strong></td>
          <td style="padding:14px 16px;font-size:14px;color:#61645b;text-align:right;">Placed on<br><strong style="font-size:14px;color:#1e201c;">${esc(when(order.paid_at || order.created_at))}</strong></td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml(env, items)}</table>
    ${totalsHtml(order)}
    <h2 style="margin:26px 0 8px;font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:#61645b;font-weight:600;">Delivering to</h2>
    <p style="margin:0;color:#1e201c;font-size:15px;line-height:1.7;">${addressLines(details).map(esc).join('<br>')}</p>
    ${order.notes ? `<h2 style="margin:22px 0 8px;font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:#61645b;font-weight:600;">Your note</h2><p style="margin:0;color:#1e201c;font-size:15px;line-height:1.7;">${esc(order.notes)}</p>` : ''}
    <h2 style="margin:22px 0 8px;font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:#61645b;font-weight:600;">Payment</h2>
    <p style="margin:0;color:#1e201c;font-size:15px;line-height:1.7;">${money(order.total_amount)} paid${method ? ` via ${esc(method)}` : ''}${payment?.razorpay_payment_id ? `<br><span style="color:#61645b;font-size:13px;">Reference: ${esc(payment.razorpay_payment_id)}</span>` : ''}</p>`);

  const text = [
    `Thank you, ${String(details.full_name || 'there').split(' ')[0]}.`,
    '',
    `Your payment was received and order ${order.order_number} is confirmed.`,
    `Placed on: ${when(order.paid_at || order.created_at)}`,
    '',
    itemsText(items),
    '',
    `Subtotal: ${money(order.subtotal ?? order.total_amount)}`,
    Number(order.discount_amount) > 0 ? `Discount (${order.discount_code}): -${money(order.discount_amount)}` : '',
    `Shipping: ${Number(order.shipping_fee) > 0 ? money(order.shipping_fee) : 'Free'}`,
    `Total paid: ${money(order.total_amount)}${method ? ` (${method})` : ''}`,
    payment?.razorpay_payment_id ? `Payment reference: ${payment.razorpay_payment_id}` : '',
    '',
    'Delivering to:',
    ...addressLines(details),
    order.notes ? `\nYour note: ${order.notes}` : '',
    '',
    'We will email you tracking details as soon as your order ships.',
    `Questions? Write to ${supportEmail(env)}.`,
    BRAND,
  ].filter((line) => line !== undefined).join('\n');

  return { subject, html, text };
}

export function buildShippedEmail(env, bundle, trackUrl) {
  const { order, items } = bundle;
  const details = order.shipping_details || {};
  const first = esc(String(details.full_name || 'there').split(' ')[0]);
  const subject = `Your order ${order.order_number} has shipped | ${BRAND}`;
  const eta = order.expected_delivery ? when(order.expected_delivery).split(',')[0] : '';

  const html = shell(env, subject, `
    <p style="margin:0 0 6px;color:#ad7655;font-size:12px;letter-spacing:2px;text-transform:uppercase;">On its way</p>
    <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-weight:normal;font-size:28px;color:#1e201c;">Good news, ${first}.</h1>
    <p style="margin:0 0 20px;color:#61645b;font-size:15px;line-height:1.7;">Your order ${esc(order.order_number)} has left us and is with the courier.${eta ? ` Expected delivery: <strong style="color:#1e201c;">${esc(eta)}</strong>.` : ''}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0e7;border-radius:10px;margin-bottom:22px;">
      <tr><td style="padding:14px 16px;font-size:14px;color:#61645b;">Courier<br><strong style="font-size:15px;color:#1e201c;">${esc(order.courier_name || '—')}</strong></td>
          <td style="padding:14px 16px;font-size:14px;color:#61645b;text-align:right;">Tracking number<br><strong style="font-size:15px;color:#1e201c;">${esc(order.awb_code || '—')}</strong></td></tr>
    </table>
    ${trackUrl ? `<p style="margin:0 0 24px;"><a href="${esc(trackUrl)}" style="display:inline-block;background:#1e201c;color:#fffdf8;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;letter-spacing:1.2px;text-transform:uppercase;">Track your parcel</a></p>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml(env, items)}</table>
    <h2 style="margin:26px 0 8px;font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:#61645b;font-weight:600;">Delivering to</h2>
    <p style="margin:0;color:#1e201c;font-size:15px;line-height:1.7;">${addressLines(details).map(esc).join('<br>')}</p>`);

  const text = [
    `Good news, ${String(details.full_name || 'there').split(' ')[0]}.`,
    '',
    `Your order ${order.order_number} has shipped.`,
    `Courier: ${order.courier_name || '-'}`,
    `Tracking number: ${order.awb_code || '-'}`,
    trackUrl ? `Track it: ${trackUrl}` : '',
    eta ? `Expected delivery: ${eta}` : '',
    '',
    itemsText(items),
    '',
    'Delivering to:',
    ...addressLines(details),
    '',
    `Questions? Write to ${supportEmail(env)}.`,
    BRAND,
  ].join('\n');

  return { subject, html, text };
}

export function buildAdminEmail(env, bundle) {
  const { order, items, payment } = bundle;
  const details = order.shipping_details || {};
  const subject = `New paid order ${order.order_number} – ${money(order.total_amount)}`;
  const adminUrl = `${siteUrl(env)}/admin.html`;

  const html = shell(env, subject, `
    <p style="margin:0 0 6px;color:#ad7655;font-size:12px;letter-spacing:2px;text-transform:uppercase;">New order</p>
    <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-weight:normal;font-size:26px;color:#1e201c;">${esc(order.order_number)} · ${money(order.total_amount)}</h1>
    <p style="margin:0 0 18px;color:#61645b;font-size:15px;line-height:1.7;">${esc(details.full_name)} · ${esc(details.phone)} · ${esc(details.email)}<br>Paid ${esc(when(order.paid_at))}${payment?.method ? ` via ${esc(methodLabel(payment.method))}` : ''}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml(env, items)}</table>
    ${totalsHtml(order)}
    <h2 style="margin:26px 0 8px;font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:#61645b;font-weight:600;">Ship to</h2>
    <p style="margin:0;color:#1e201c;font-size:15px;line-height:1.7;">${addressLines(details).map(esc).join('<br>')}</p>
    ${order.notes ? `<h2 style="margin:22px 0 8px;font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:#61645b;font-weight:600;">Customer note</h2><p style="margin:0;color:#1e201c;font-size:15px;line-height:1.7;">${esc(order.notes)}</p>` : ''}
    <p style="margin:26px 0 0;"><a href="${esc(adminUrl)}" style="display:inline-block;background:#1e201c;color:#fffdf8;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;letter-spacing:1.2px;text-transform:uppercase;">Open admin panel</a></p>`);

  const text = [
    `New paid order ${order.order_number} – ${money(order.total_amount)}`,
    `${details.full_name} · ${details.phone} · ${details.email}`,
    '',
    itemsText(items),
    '',
    'Ship to:',
    ...addressLines(details),
    order.notes ? `\nCustomer note: ${order.notes}` : '',
    '',
    adminUrl,
  ].join('\n');

  return { subject, html, text };
}

export async function sendEmail(env, { to, subject, html, text, replyTo, idempotencyKey }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
  if (!env.EMAIL_FROM) throw new Error('EMAIL_FROM is not configured');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      reply_to: replyTo || supportEmail(env),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let message = '';
    try { message = (await res.json()).message || ''; } catch { /* ignore */ }
    throw new Error(`Resend ${res.status}: ${message || 'send failed'}`);
  }
  return res.json();
}
