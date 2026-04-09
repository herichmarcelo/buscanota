import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type InfosimplesProduto = {
  descricao?: string;
  nome?: string;
  xProd?: string;
  produto?: string;
  unidade_comercial?: string;
  quantidade_comercial?: string | number;
  unidade?: string;
  quantidade?: string | number;
  qtd?: string | number;
  qCom?: string | number;
  uCom?: string;
};

function asNumber(v: unknown) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function firstArray(...vals: any[]): any[] {
  for (const v of vals) if (Array.isArray(v) && v.length) return v;
  return [];
}

function pick(obj: any, path: string) {
  return path.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
}

function extractProdutos(payload: any): InfosimplesProduto[] {
  const data0 = Array.isArray(payload?.data) ? payload.data[0] : payload?.data ?? null;
  return firstArray(
    pick(data0, "nfe_completa.produtos"),
    pick(data0, "nfe_completa.nfe_completa.produtos"),
    pick(data0, "resumida.produtos"),
    pick(data0, "nfe.produtos"),
    pick(data0, "produtos"),
    pick(payload, "produtos"),
    pick(payload, "data.produtos"),
  ) as InfosimplesProduto[];
}

function extractDataEmissao(payload: any): string | null {
  const data0 = Array.isArray(payload?.data) ? payload.data[0] : payload?.data ?? null;
  const candidates = [
    pick(data0, "nfe.data_emissao"),
    pick(data0, "nfe.data_hora_da_emissao"),
    pick(data0, "nfe_completa.nfe.data_emissao"),
    pick(data0, "nfe_completa.nfe.data_hora_da_emissao"),
    pick(data0, "data_emissao"),
  ];
  const v = candidates.find((x) => typeof x === "string" && x.length) ?? null;
  return v;
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
  const url = new URL(req.url);
  const qsSecret = url.searchParams.get("secret");
  const auth = req.headers.get("authorization") ?? "";

  // Autorização por secret (opcional, útil para cron externo)
  const secret = process.env.NFE_WORKER_SECRET ?? null;
  const okBySecret =
    !!secret &&
    (auth === `Bearer ${secret}` || (qsSecret !== null && qsSecret === secret));

  // Autorização por sessão Supabase (para poder rodar no Vercel Hobby sem cron)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  let okBySupabase = false;
  if (token && supabaseUrl && supabaseAnon) {
    const sb = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.getUser();
    okBySupabase = !error && !!data.user;
  }

  if (!okBySecret && !okBySupabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY não configurada no server." },
      { status: 500 },
    );
  }

  const infosimplesToken = process.env.INFOSIMPLES_TOKEN;
  if (!infosimplesToken) {
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
    const fetched = await infosimplesFetchNfe(infosimplesToken, chave);
    if (!fetched.ok) throw new Error(fetched.error);

    const json = fetched.json;
    const dataEmissao = extractDataEmissao(json);
    const produtos = extractProdutos(json);

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
      descricao: String(p.descricao ?? p.xProd ?? p.nome ?? p.produto ?? "")
        .trim()
        .replace(/\s+/g, " ") || "ITEM",
      unidade: String(p.unidade_comercial ?? p.uCom ?? p.unidade ?? "").trim(),
      quantidade_total: asNumber(
        p.quantidade_comercial ?? p.qCom ?? p.qtd ?? p.quantidade,
      ),
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

