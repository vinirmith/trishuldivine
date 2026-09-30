// Cloudflare Pages Function: forwards /api/* to Supabase so browsers only ever
// talk to trishuldivine.com (some ISPs block *.supabase.co directly).
const SUPABASE_HOST = 'acnhzuiisexsiuondawt.supabase.co';

export async function onRequest({ request }) {
  const url = new URL(request.url);
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
}
