import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateBearerSession } from "@/lib/validateBearerSession";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Limites do dia civil em America/Sao_Paulo (UTC−3 fixo). */
function boundsDiaSaoPaulo(yyyyMmDd: string): { startMs: number; endMs: number } {
  const start = new Date(`${yyyyMmDd}T00:00:00-03:00`);
  const end = new Date(`${yyyyMmDd}T23:59:59.999-03:00`);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chave = (url.searchParams.get("chave") ?? "").replace(/\D/g, "");
  const dia = url.searchParams.get("dia") ?? "";

  if (chave.length !== 44) {
    return NextResponse.json(
      { error: "Informe chave com 44 dígitos." },
      { status: 400 },
    );
  }
  if (!DIA_RE.test(dia)) {
    return NextResponse.json(
      { error: "Informe dia no formato YYYY-MM-DD." },
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

  const sb = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: nota, error: notaErr } = await sb
    .from("notas")
    .select(
      "id, chave_acesso, data_emissao, payload, itens_nota ( id, descricao, unidade, quantidade_total, quantidade_entregue, saldo_restante, status, ultima_retirada_em )",
    )
    .eq("chave_acesso", chave)
    .maybeSingle();

  if (notaErr) {
    return NextResponse.json({ error: notaErr.message }, { status: 500 });
  }
  if (!nota) {
    return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  }

  const { startMs, endMs } = boundsDiaSaoPaulo(dia);
  const raw = (nota as any).itens_nota ?? [];
  const itensDia = raw.filter((row: { ultima_retirada_em?: string | null }) => {
    if (!row.ultima_retirada_em) return false;
    const t = new Date(row.ultima_retirada_em).getTime();
    return t >= startMs && t <= endMs;
  });

  return NextResponse.json({
    ok: true,
    dia,
    nota: {
      id: nota.id,
      chave_acesso: nota.chave_acesso,
      data_emissao: nota.data_emissao,
      payload: nota.payload,
    },
    itens: itensDia,
  });
}
