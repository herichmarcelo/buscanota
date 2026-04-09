import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { chave_acesso?: string }
    | null;
  const chave = (body?.chave_acesso ?? "").replace(/\D/g, "");

  if (chave.length !== 44) {
    return NextResponse.json(
      { error: "Informe chave_acesso com 44 dígitos." },
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

  const { data: nota, error: notaErr } = await admin
    .from("notas")
    .select("id, entrega_fechada")
    .eq("chave_acesso", chave)
    .maybeSingle();

  if (notaErr) {
    return NextResponse.json({ error: notaErr.message }, { status: 500 });
  }
  if (!nota) {
    return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  }
  if (nota.entrega_fechada) {
    return NextResponse.json(
      { error: "Esta entrega já está fechada." },
      { status: 409 },
    );
  }

  const { data: itens, error: itensErr } = await admin
    .from("itens_nota")
    .select("id, quantidade_total")
    .eq("nota_id", nota.id);

  if (itensErr) {
    return NextResponse.json({ error: itensErr.message }, { status: 500 });
  }

  const agora = new Date().toISOString();

  for (const row of itens ?? []) {
    const total = Number(row.quantidade_total ?? 0);
    const { error: upErr } = await admin
      .from("itens_nota")
      .update({
        quantidade_entregue: total,
        status: "ENTREGUE",
        saldo_restante: 0,
        ultima_retirada_em: agora,
      })
      .eq("id", row.id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  const { error: notaUpErr } = await admin
    .from("notas")
    .update({
      entrega_fechada: true,
      entrega_fechada_em: agora,
      entrega_fechada_por: u.user.id,
    })
    .eq("id", nota.id);

  if (notaUpErr) {
    return NextResponse.json({ error: notaUpErr.message }, { status: 500 });
  }

  const { data: full, error: loadErr } = await admin
    .from("notas")
    .select("*, itens_nota(*)")
    .eq("id", nota.id)
    .single();

  if (loadErr) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, nota: full });
}
