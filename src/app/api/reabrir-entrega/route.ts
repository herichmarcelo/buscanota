import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { extractHeaderFromNota } from "@/lib/notaHeader";
import { validateBearerSession } from "@/lib/validateBearerSession";
import { isMissingEntregaFechadaColumn } from "@/lib/notaEntregaFechadaColumn";

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

  const authResult = await validateBearerSession(
    supabaseUrl,
    supabaseAnon,
    token,
  );
  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status },
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY não configurada no server." },
      { status: 500 },
    );
  }

  const rSel = await admin
    .from("notas")
    .select("id, entrega_fechada")
    .eq("chave_acesso", chave)
    .maybeSingle();

  let nota: { id: string; entrega_fechada?: boolean } | null = null;

  if (rSel.error && isMissingEntregaFechadaColumn(rSel.error.message)) {
    return NextResponse.json(
      { error: "Coluna entrega_fechada ausente. Aplique a migration no Supabase." },
      { status: 500 },
    );
  }
  if (rSel.error) {
    return NextResponse.json({ error: rSel.error.message }, { status: 500 });
  }
  nota = rSel.data as { id: string; entrega_fechada?: boolean } | null;

  if (!nota) {
    return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  }
  if (!nota.entrega_fechada) {
    return NextResponse.json(
      { error: "Esta entrega não está fechada." },
      { status: 409 },
    );
  }

  const agora = new Date().toISOString();

  const { error: notaUpErr } = await admin
    .from("notas")
    .update({
      entrega_fechada: false,
      entrega_fechada_em: null,
      entrega_fechada_por: null,
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
    return NextResponse.json({
      ok: true,
      entrega_fechada: false,
    });
  }

  const notaResumo = extractHeaderFromNota(full);

  const { error: evErr } = await admin.from("nfe_eventos").insert({
    chave_acesso: chave,
    user_id: authResult.user.id,
    tipo: "ENTREGA",
    payload: {
      acao: "reabrir_entrega",
      reaberto_em: agora,
      nota_resumo: notaResumo,
    },
  });

  const avisoRelatorio = evErr
    ? `Entrega reaberta, mas o evento não foi gravado no histórico: ${evErr.message}`
    : null;

  return NextResponse.json({
    ok: true,
    nota: full,
    entrega_fechada: false,
    ...(avisoRelatorio ? { aviso_relatorio: avisoRelatorio } : {}),
  });
}
