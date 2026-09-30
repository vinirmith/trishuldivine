// Serves the static site and forwards /api/* to Supabase so browsers only talk
// to trishuldivine.com (some ISPs block *.supabase.co directly).
const SUPABASE_HOST = 'acnhzuiisexsiuondawt.supabase.co';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
