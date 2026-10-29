// Serves the static site, handles checkout/payment endpoints (/payments/*, see
// src/server/payments.js), Shiprocket shipping (/shipping/*, src/server/shipping.js) and forwards /api/* to Supabase so browsers only talk to
// trishuldivine.com (some ISPs block *.supabase.co directly).
import { handlePayments } from './server/payments.js';
import { handleShipping } from './server/shipping.js';

const SUPABASE_HOST = 'acnhzuiisexsiuondawt.supabase.co';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/payments' || url.pathname.startsWith('/payments/')) {
      return handlePayments(request, env, ctx);
    }
    if (url.pathname.startsWith('/shipping/')) {
      return handleShipping(request, env, ctx);
    }

    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    url.hostname = SUPABASE_HOST;
    url.protocol = 'https:';
    url.port = '';
    url.pathname = url.pathname.replace(/^\/api/, '') || '/';

    const headers = new Headers(request.headers);
    headers.delete('host');

    return fetch(new Request(url, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    }));
  },
};
