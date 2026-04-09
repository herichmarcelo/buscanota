import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type InfosimplesProduto = {
  descricao?: string;
  unidade_comercial?: string;
  quantidade_comercial?: string | number;
};

function asNumber(v: unknown) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { chave?: string } | null;
  const chave = body?.chave?.trim() ?? "";

  if (!/^\d{44}$/.test(chave)) {
    return NextResponse.json(
      { error: "Chave inválida. Deve conter 44 dígitos." },
      { status: 400 },
    );
  }

  const token = process.env.INFOSIMPLES_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "INFOSIMPLES_TOKEN não configurado no server." },
      { status: 500 },
    );
  }

  // 1) Consulta Infosimples (pode demorar por RPA/captcha)
  // IMPORTANTE: a URL "bonita" do catálogo (ex: infosimples.com/consultas/...) NÃO é o endpoint da API.
  // A API v2 costuma ficar em /api/v2/consultas/<slug>.
  // Como o slug pode variar (receita-federal/nfe vs receita-federal-nfe vs sefaz/nfe),
  // tentamos algumas opções comuns e retornamos erro detalhado se nenhuma funcionar.
  const startUrlCandidates = [
    "https://api.infosimples.com/api/v2/consultas/receita-federal/nfe",
    "https://api.infosimples.com/api/v2/consultas/receita-federal-nfe",
    "https://api.infosimples.com/api/v2/consultas/sefaz/nfe",
  ] as const;

  // Cache rápido: se já existe no Supabase, devolve sem chamar Infosimples
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
    return NextResponse.json({ ok: true, nota: cached, itens: cached.itens_nota ?? [] });
  }

  async function callStart(startUrl: string) {
    const resp = await fetch(startUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token,
        nfe: chave,
      }),
    });
    const json = (await resp.json().catch(() => null)) as any;
    return { resp, json };
  }

  async function callResult(startUrl: string, id: string) {
    const url = `${startUrl}/resultado/${encodeURIComponent(id)}`;
    const resp = await fetch(url);
    const json = (await resp.json().catch(() => null)) as any;
    return { resp, json };
  }

  // start (tenta múltiplos endpoints)
  let startUrlUsed: string | null = null;
  let resp: Response | null = null;
  let json: any = null;

  for (const u of startUrlCandidates) {
    const r = await callStart(u);
    resp = r.resp;
    json = r.json;
    if (resp.ok && json) {
      startUrlUsed = u;
      break;
    }
  }

  if (!startUrlUsed || !resp || !json || !resp.ok) {
    return NextResponse.json(
      {
        error: `Falha ao consultar Infosimples (${resp?.status ?? "?"}).`,
        details: json?.message ?? json?.error ?? null,
        tried: startUrlCandidates,
      },
      { status: 502 },
    );
  }

  // fluxo assíncrono: se vier code 202 + id, faz polling por alguns segundos
  const code = typeof json.code === "number" ? json.code : Number(json.code);
  if (code === 202 && json.id) {
    const id = String(json.id);
    const deadline = Date.now() + 25_000;
    let last: any = json;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1200));
      const r2 = await callResult(startUrlUsed, id);
      resp = r2.resp;
      json = r2.json;
      last = json ?? last;

      const c2 = typeof json?.code === "number" ? json.code : Number(json?.code);
      if (resp.ok && c2 === 200) break;
      if (resp.ok && c2 && c2 !== 202 && c2 !== 200) {
        return NextResponse.json(
          {
            error: `Infosimples retornou code=${c2}.`,
            details: json?.message ?? json?.error ?? null,
          },
          { status: 502 },
        );
      }
    }
  }

  const finalCode =
    typeof json?.code === "number" ? json.code : Number(json?.code);
  if (!json || (finalCode && finalCode !== 200)) {
    return NextResponse.json(
      {
        error: "Falha no robô da Infosimples (ou ainda processando).",
        details: json?.message ?? json?.error ?? null,
        code: json?.code ?? null,
      },
      { status: 502 },
    );
  }

  // tenta localizar o payload da nota (varia conforme retorno)
  const data0 = Array.isArray(json.data) ? json.data[0] : null;
  const notaCompleta =
    data0?.nfe_completa ??
    data0?.nfe ??
    data0 ??
    null;

  const dataEmissao =
    notaCompleta?.nfe?.data_emissao ??
    notaCompleta?.data_emissao ??
    null;

  const produtos: InfosimplesProduto[] =
    notaCompleta?.produtos ??
    notaCompleta?.itens ??
    [];

  // 2) Salva no Supabase (service role para bypass RLS e permitir cache)
  const { data: notaRow, error: upsertErr } = await admin
    .from("notas")
    .upsert(
      {
        chave_acesso: chave,
        data_emissao: dataEmissao,
        payload: json,
      },
      { onConflict: "chave_acesso" },
    )
    .select()
    .single();

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // Recria itens (simples e consistente com a origem)
  await admin.from("itens_nota").delete().eq("nota_id", notaRow.id);

  const itensParaSalvar = (produtos ?? []).map((p) => ({
    nota_id: notaRow.id,
    descricao: String(p.descricao ?? "").trim() || "ITEM",
    unidade: String(p.unidade_comercial ?? "").trim(),
    quantidade_total: asNumber(p.quantidade_comercial),
    quantidade_entregue: 0,
    status: "PENDENTE",
  }));

  if (itensParaSalvar.length) {
    const { error: itensErr } = await admin.from("itens_nota").insert(itensParaSalvar);
    if (itensErr) {
      return NextResponse.json({ error: itensErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    nota: notaRow,
    itens: itensParaSalvar,
  });
}

