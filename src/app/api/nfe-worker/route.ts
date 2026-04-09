import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createClient } from "@supabase/supabase-js";
import {
  asNumberProduto,
  extractProdutosFromInfosimplesPayload,
  normalizeDescricaoProduto,
} from "@/lib/infosimplesNfeProdutos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function pick(obj: any, path: string) {
  return path.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
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
  const raw = candidates.find((x) => typeof x === "string" && x.length) ?? null;
  if (!raw) return null;

  const brMatch =
    /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?([+-]\d{2}:\d{2})?$/.exec(
      raw,
    );
  if (brMatch) {
    const [, dd, mm, yyyy, HH, MM, SS = "00", tz = "Z"] = brMatch;
    return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}${tz}`;
  }

  return raw;
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

  const secret = process.env.NFE_WORKER_SECRET ?? null;
  const okBySecret =
    !!secret &&
    (auth === `Bearer ${secret}` || (qsSecret !== null && qsSecret === secret));

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

  const { data: jobs, error: jobsErr } = await admin
    .from("nfe_jobs")
    .select("*")
    .in("status", ["PENDENTE", "ERRO"])
    .order("criado_em", { ascending: true })
    .limit(1);

  if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });
  const job = jobs?.[0];
  if (!job) return NextResponse.json({ ok: true, processed: 0 });

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
    const produtos = extractProdutosFromInfosimplesPayload(json);

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
    const itensParaSalvar = (produtos ?? []).map((p) => {
      const qtd = asNumberProduto(
        p.quantidade_comercial ?? p.qCom ?? p.qtd ?? p.quantidade,
      );
      return {
        nota_id: notaRow.id,
        descricao: normalizeDescricaoProduto(p),
        unidade: String(p.unidade_comercial ?? p.uCom ?? p.unidade ?? "").trim(),
        quantidade_total: qtd,
        quantidade_entregue: 0,
        saldo_restante: qtd,
        status: "PENDENTE",
      };
    });
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
