import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { salvarNotaViaMeuDanfe } from "@/lib/salvarNotaMeuDanfe";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { chave?: string } | null;
  const chave = body?.chave?.trim() ?? "";

  if (!/^\d{44}$/.test(chave)) {
    return NextResponse.json(
      { error: "Chave inválida. Deve conter 44 dígitos." },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY não configurada no server." },
      { status: 500 },
    );
  }

  const { data: cached, error: cachedErr } = await admin
    .from("notas")
    .select("*, itens_nota(*)")
    .eq("chave_acesso", chave)
    .maybeSingle();
  if (cachedErr) {
    return NextResponse.json({ error: cachedErr.message }, { status: 500 });
  }
  if (cached) {
    return NextResponse.json({
      ok: true,
      nota: cached,
      itens: cached.itens_nota ?? [],
    });
  }

  const saved = await salvarNotaViaMeuDanfe(admin, chave);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    nota: saved.nota,
    itens: saved.nota?.itens_nota ?? [],
  });
}
