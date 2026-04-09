import { createClient } from "@supabase/supabase-js";
import { validateBearerSession } from "@/lib/validateBearerSession";

export async function requireSuperadmin(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!url || !anon) {
    return { ok: false as const, status: 500, error: "Supabase não configurado." };
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (!token) {
    return { ok: false as const, status: 401, error: "Token ausente." };
  }

  const v = await validateBearerSession(url, anon, token);
  if (!v.ok) {
    return { ok: false as const, status: v.status, error: v.error };
  }

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: perr } = await sb
    .from("profiles")
    .select("role")
    .eq("id", v.user.id)
    .maybeSingle();

  if (perr) {
    return { ok: false as const, status: 500, error: "Falha ao ler perfil." };
  }

  if (profile?.role !== "superadmin") {
    return { ok: false as const, status: 403, error: "Acesso negado." };
  }

  return { ok: true as const, user: v.user };
}

