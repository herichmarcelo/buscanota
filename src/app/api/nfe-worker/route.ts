import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createClient } from "@supabase/supabase-js";
import { salvarNotaViaMeuDanfe } from "@/lib/salvarNotaMeuDanfe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    const saved = await salvarNotaViaMeuDanfe(admin, chave);
    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const notaRow = saved.nota;

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
    return NextResponse.json(
      { ok: false, processed: 1, error: e?.message ?? "Erro" },
      { status: 502 },
    );
  }
}
