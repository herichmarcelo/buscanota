import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { item_id?: string; quantidade_entregue?: number }
    | null;

  const itemId = body?.item_id ?? "";
  const qEntregue = Number(body?.quantidade_entregue);

  if (!itemId) {
    return NextResponse.json({ error: "Informe item_id." }, { status: 400 });
  }
  if (!Number.isFinite(qEntregue)) {
    return NextResponse.json(
      { error: "Informe quantidade_entregue válida." },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return NextResponse.json(
      { error: "Supabase não configurado." },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (!token) {
    return NextResponse.json({ error: "Token ausente." }, { status: 401 });
  }

  // valida sessão do usuário (não precisa ser superadmin; baixa é operação)
  const sb = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: uerr } = await sb.auth.getUser();
  if (uerr || !u.user) {
    return NextResponse.json({ error: "Token inválido." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY não configurada no server." },
      { status: 500 },
    );
  }

  // lê o item atual
  const { data: item, error: itemErr } = await admin
    .from("itens_nota")
    .select("id, nota_id, quantidade_total, quantidade_entregue, status")
    .eq("id", itemId)
    .single();
  if (itemErr) {
    return NextResponse.json({ error: itemErr.message }, { status: 500 });
  }

  const { data: notaPai, error: notaErr } = await admin
    .from("notas")
    .select("entrega_fechada")
    .eq("id", item.nota_id)
    .single();
  if (notaErr) {
    return NextResponse.json({ error: notaErr.message }, { status: 500 });
  }
  if (notaPai?.entrega_fechada) {
    return NextResponse.json(
      { error: "Entrega fechada: não é possível alterar quantidades." },
      { status: 403 },
    );
  }

  const total = Number(item.quantidade_total ?? 0);
  const current = Number(item.quantidade_entregue ?? 0);
  const next = clamp(qEntregue, 0, total);

  const status =
    next === 0 ? "PENDENTE" : next >= total ? "ENTREGUE" : "PARCIAL";
  const saldoRestante = Math.max(0, total - next);

  const { data: updated, error: updErr } = await admin
    .from("itens_nota")
    .update({
      quantidade_entregue: next,
      status,
      saldo_restante: saldoRestante,
      ultima_retirada_em: next !== current ? new Date().toISOString() : null,
    })
    .eq("id", itemId)
    .select()
    .single();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, item: updated });
}

