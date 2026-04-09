import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

async function infosimplesFetchNfe(token: string, chave: string) {
  const candidates = [
    "https://api.infosimples.com/api/v2/consultas/receita-federal/nfe",
    "https://api.infosimples.com/api/v2/consultas/receita-federal-nfe",
    "https://api.infosimples.com/api/v2/consultas/sefaz/nfe",
  ] as const;

  for (const u of candidates) {
    const resp = await fetch(u, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, nfe: chave }),
    });
    const json = (await resp.json().catch(() => null)) as any;
    if (resp.ok && json) return { ok: true as const, url: u, json };
  }

  return { ok: false as const, error: "Nenhum endpoint Infosimples respondeu OK." };
}

export async function POST(req: Request) {
  const secret = process.env.NFE_WORKER_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "NFE_WORKER_SECRET não configurado no server." },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const qsSecret = url.searchParams.get("secret");
  const auth = req.headers.get("authorization") ?? "";
  const okByHeader = auth === `Bearer ${secret}`;
  const okByQuery = qsSecret === secret;
  if (!okByHeader && !okByQuery) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY não configurada no server." },
      { status: 500 },
    );
  }

  const token = process.env.INFOSIMPLES_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "INFOSIMPLES_TOKEN não configurado no server." },
      { status: 500 },
    );
  }

  // pega 1 job pendente
  const { data: jobs, error: jobsErr } = await admin
    .from("nfe_jobs")
    .select("*")
    .in("status", ["PENDENTE", "ERRO"])
    .order("criado_em", { ascending: true })
    .limit(1);

  if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });
  const job = jobs?.[0];
  if (!job) return NextResponse.json({ ok: true, processed: 0 });

  // marca como processando
  await admin
    .from("nfe_jobs")
    .update({
      status: "PROCESSANDO",
      iniciado_em: new Date().toISOString(),
      tentativas: (job.tentativas ?? 0) + 1,
      erro: null,
    })
    .eq("id", job.id);

  try {
    const chave = String(job.chave_acesso);
    const fetched = await infosimplesFetchNfe(token, chave);
    if (!fetched.ok) throw new Error(fetched.error);

    const json = fetched.json;
    const data0 = Array.isArray(json.data) ? json.data[0] : null;
    const notaCompleta = data0?.nfe_completa ?? data0?.nfe ?? data0 ?? null;
    const dataEmissao =
      notaCompleta?.nfe?.data_emissao ?? notaCompleta?.data_emissao ?? null;
    const produtos: InfosimplesProduto[] =
      notaCompleta?.produtos ?? notaCompleta?.itens ?? [];

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
    if (upsertErr) throw upsertErr;

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
      if (itensErr) throw itensErr;
    }

    await admin
      .from("nfe_jobs")
      .update({
        status: "OK",
        nota_id: notaRow.id,
        finalizado_em: new Date().toISOString(),
      })
      .eq("id", job.id);

    return NextResponse.json({ ok: true, processed: 1, job_id: job.id });
  } catch (e: any) {
    await admin
      .from("nfe_jobs")
      .update({
        status: "ERRO",
        erro: e?.message ?? "Erro desconhecido",
        finalizado_em: new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json({ ok: false, processed: 1, error: e?.message ?? "Erro" }, { status: 502 });
  }
}

