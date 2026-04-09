import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validateBearerSession } from "@/lib/validateBearerSession";
import { readNotaEntregaFechada } from "@/lib/notaEntregaFechadaColumn";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { item_id?: string }
    | null;
  const itemId = body?.item_id ?? "";

  if (!itemId) {
    return NextResponse.json({ error: "Informe item_id." }, { status: 400 });
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

  const { data: item, error: itemErr } = await admin
    .from("itens_nota")
    .select(
      "id, nota_id, status, parcial_confirmada, quantidade_total, quantidade_entregue",
    )
    .eq("id", itemId)
    .single();

  if (itemErr) {
    return NextResponse.json({ error: itemErr.message }, { status: 500 });
  }

  const { fechada, error: notaReadErr } = await readNotaEntregaFechada(
    admin,
    item.nota_id,
  );
  if (notaReadErr) {
    return NextResponse.json({ error: notaReadErr }, { status: 500 });
  }
  if (fechada) {
    return NextResponse.json(
      { error: "Entrega fechada: não é possível confirmar parcial." },
      { status: 403 },
    );
  }

  const total = Number((item as { quantidade_total?: number }).quantidade_total ?? 0);
  const ent = Number((item as { quantidade_entregue?: number }).quantidade_entregue ?? 0);
  if (total > 0 && ent >= total) {
    return NextResponse.json(
      { error: "Linha já totalmente entregue." },
      { status: 400 },
    );
  }

  if (item.status !== "PARCIAL") {
    return NextResponse.json(
      { error: "Só é possível confirmar quando o item está em entrega parcial." },
      { status: 400 },
    );
  }

  if ((item as { parcial_confirmada?: boolean }).parcial_confirmada) {
    return NextResponse.json(
      { error: "Esta entrega parcial já foi confirmada." },
      { status: 409 },
    );
  }

  const { data: updated, error: updErr } = await admin
    .from("itens_nota")
    .update({ parcial_confirmada: true })
    .eq("id", itemId)
    .select()
    .single();

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: updated });
}
