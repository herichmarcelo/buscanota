import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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

  // Se já existe a nota no cache, evita job.
  const { data: cached, error: cachedErr } = await admin
    .from("notas")
    .select("id")
    .eq("chave_acesso", chave)
    .maybeSingle();
  if (cachedErr) return NextResponse.json({ error: cachedErr.message }, { status: 500 });
  if (cached?.id) return NextResponse.json({ ok: true, status: "OK", nota_id: cached.id });

  // Cria job (upsert) e retorna id/status.
  const { data: job, error: jobErr } = await admin
    .from("nfe_jobs")
    .upsert(
      { chave_acesso: chave, status: "PENDENTE" },
      { onConflict: "chave_acesso" },
    )
    .select()
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, job });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chave = url.searchParams.get("chave")?.trim() ?? "";
  if (!/^\d{44}$/.test(chave)) {
    return NextResponse.json(
      { error: "Informe ?chave= (44 dígitos)." },
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

  const { data: job, error: jobErr } = await admin
    .from("nfe_jobs")
    .select("*")
    .eq("chave_acesso", chave)
    .maybeSingle();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  // Se não existe job, ainda pode existir cache (nota já salva).
  if (!job) {
    const { data: nota, error: notaErr } = await admin
      .from("notas")
      .select("*, itens_nota(*)")
      .eq("chave_acesso", chave)
      .maybeSingle();
    if (notaErr) return NextResponse.json({ error: notaErr.message }, { status: 500 });
    if (nota) return NextResponse.json({ ok: true, job: { status: "OK" }, nota });
    return NextResponse.json(
      { error: "Job não encontrado para esta chave." },
      { status: 404 },
    );
  }

  // Se terminou OK, já devolve a nota+itens (pra UI atualizar sem outra chamada)
  if (job?.status === "OK") {
    const { data: nota, error: notaErr } = await admin
      .from("notas")
      .select("*, itens_nota(*)")
      .eq("chave_acesso", chave)
      .maybeSingle();
    if (notaErr) return NextResponse.json({ error: notaErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, job, nota });
  }

  return NextResponse.json({ ok: true, job });
}

