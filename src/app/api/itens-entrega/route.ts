import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validateBearerSession } from "@/lib/validateBearerSession";
import {
  readNotaEntregaFechada,
} from "@/lib/notaEntregaFechadaColumn";

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

  // lê o item atual
  const { data: item, error: itemErr } = await admin
    .from("itens_nota")
    .select("id, nota_id, quantidade_total, quantidade_entregue, status, parcial_confirmada")
    .eq("id", itemId)
    .single();
  if (itemErr) {
    return NextResponse.json({ error: itemErr.message }, { status: 500 });
  }

  const { fechada: notaFechada, error: notaReadErr } =
    await readNotaEntregaFechada(admin, item.nota_id);
  if (notaReadErr) {
    return NextResponse.json({ error: notaReadErr }, { status: 500 });
  }
  if (notaFechada) {
    return NextResponse.json(
      { error: "Entrega fechada: não é possível alterar quantidades." },
      { status: 403 },
    );
  }

  const total = Number(item.quantidade_total ?? 0);
  const current = Number(item.quantidade_entregue ?? 0);
  const next = clamp(qEntregue, 0, total);

  const linhaTotalmenteEntregue =
    item.status === "ENTREGUE" || (total > 0 && current >= total);
  if (linhaTotalmenteEntregue && next !== current) {
    return NextResponse.json(
      {
        error:
          "Esta linha já foi totalmente entregue e não pode ser alterada. Continue apenas nas linhas com saldo.",
      },
      { status: 403 },
    );
  }
  const parcialConfirmada = Boolean(
    (item as { parcial_confirmada?: boolean }).parcial_confirmada,
  );

  if (next < current) {
    if (parcialConfirmada) {
      return NextResponse.json(
        {
          error:
            "Entrega parcial confirmada: não é permitido reduzir a quantidade entregue.",
        },
        { status: 403 },
      );
    }
    if (current >= total || item.status === "ENTREGUE") {
      return NextResponse.json(
        {
          error:
            "Linha totalmente entregue: não é permitido reduzir a quantidade.",
        },
        { status: 403 },
      );
    }
  }

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

