import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseClient() {
  if (_client) return _client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return null;

  _client = createClient(supabaseUrl, supabaseAnonKey);
  return _client;
}

/** POST com Bearer; em 401 tenta refresh da sessão e repete uma vez (JWT expirado). */
export async function postJsonWithAuthRetry(
  sb: SupabaseClient,
  url: string,
  body: Record<string, unknown>,
): Promise<Response> {
  let { data } = await sb.auth.getSession();
  let token: string | undefined = data.session?.access_token;
  if (!token) {
    const ref = await sb.auth.refreshSession();
    token = ref.data.session?.access_token;
  }
  if (!token) {
    return new Response(
      JSON.stringify({
        error: "Sessão expirada. Entre novamente na conta.",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const doFetch = (t: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
      },
      body: JSON.stringify(body),
    });

  let r = await doFetch(token);
  if (r.status === 401) {
    const ref = await sb.auth.refreshSession();
    const t2 = ref.data.session?.access_token;
    if (t2) r = await doFetch(t2);
  }
  return r;
}

