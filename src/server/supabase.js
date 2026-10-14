// Talks to Supabase with the service-role key. Only ever runs inside the Worker.
export class SupabaseError extends Error {
  constructor(status, body) {
    super(body?.message || `Supabase error ${status}`);
    this.status = status;
    this.code = body?.code;
    this.details = body?.details;
  }
}

const baseUrl = (env) => String(env.SUPABASE_URL || 'https://acnhzuiisexsiuondawt.supabase.co').replace(/\/+$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => UUID.test(String(value || ''));

const serviceHeaders = (env, extra = {}) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  ...extra,
});

const parse = async (res) => {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 300) }; }
};

export async function rpc(env, name, args = {}) {
  const res = await fetch(`${baseUrl(env)}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15000),
  });
  const body = await parse(res);
  if (!res.ok) throw new SupabaseError(res.status, body);
  return body;
}

// Returns the Supabase user for a browser access token, or null.
export async function getUserFromToken(env, token) {
  if (!token) return null;
  const res = await fetch(`${baseUrl(env)}/auth/v1/user`, {
    headers: serviceHeaders(env, { Authorization: `Bearer ${token}` }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const user = await parse(res);
  return user && isUuid(user.id) ? user : null;
}

export async function isAdminUser(env, userId) {
  if (!isUuid(userId)) return false;
  const res = await fetch(`${baseUrl(env)}/rest/v1/admin_users?select=user_id&user_id=eq.${userId}`, {
    headers: serviceHeaders(env),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new SupabaseError(res.status, await parse(res));
  const rows = await parse(res);
  return Array.isArray(rows) && rows.length > 0;
}
