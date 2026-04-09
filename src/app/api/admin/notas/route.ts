import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSuperadmin } from "@/lib/requireSuperadmin";

export async function DELETE(req: Request) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY não configurada no server." },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const chave = url.searchParams.get("chave") ?? "";

  if (!id && !chave) {
    return NextResponse.json(
      { error: "Informe ?id= ou ?chave=" },
      { status: 400 },
    );
  }

  const q = admin.from("notas").delete();
  const { error } = id ? await q.eq("id", id) : await q.eq("chave_acesso", chave);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

