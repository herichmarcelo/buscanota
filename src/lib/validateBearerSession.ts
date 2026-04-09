import { createClient, type User } from "@supabase/supabase-js";

function isAuthTransportFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: string; name?: string; cause?: unknown };
  const msg = `${e.message ?? ""} ${e.name ?? ""}`.toLowerCase();
  if (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("connecttimeout") ||
    msg.includes("und_err") ||
    e.name === "AuthRetryableFetchError"
  ) {
    return true;
  }
  const c = e.cause;
  if (c && typeof c === "object" && "code" in c) {
    const code = String((c as { code?: string }).code ?? "");
    if (
      code.includes("TIMEOUT") ||
      code.includes("ECONNRESET") ||
      code.includes("ETIMEDOUT")
    ) {
      return true;
    }
  }
  return false;
}

export type ValidateBearerResult =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Valida o JWT com o Auth do Supabase. Falhas de rede não devem ser tratadas como token inválido.
 */
export async function validateBearerSession(
  supabaseUrl: string,
  supabaseAnon: string,
  token: string,
): Promise<ValidateBearerResult> {
  const sb = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: u, error: uerr } = await sb.auth.getUser();

  if (uerr) {
    if (isAuthTransportFailure(uerr)) {
      return {
        ok: false,
        status: 503,
        error:
          "Autenticação temporariamente indisponível (rede ou Supabase). Tente de novo em instantes.",
      };
    }
    return {
      ok: false,
      status: 401,
      error:
        "Sessão expirada ou token inválido. Saia e entre novamente na conta.",
    };
  }

  if (!u.user) {
    return {
      ok: false,
      status: 401,
      error:
        "Sessão expirada ou token inválido. Saia e entre novamente na conta.",
    };
  }

  return { ok: true, user: u.user };
}
