import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSuperadmin } from "@/lib/requireSuperadmin";

export async function GET(req: Request) {
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

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data.users });
}

export async function POST(req: Request) {
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

  const body = (await req.json().catch(() => null)) as
    | { email?: string; password?: string; nome?: string; role?: string }
    | null;

  const email = body?.email?.trim() ?? "";
  const password = body?.password ?? "";
  const nome = body?.nome?.trim() ?? null;
  const role = body?.role === "superadmin" ? "superadmin" : "estoquista";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Informe email e senha." },
      { status: 400 },
    );
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // grava profile (role/nome)
  await admin.from("profiles").upsert({
    id: data.user.id,
    nome,
    role,
  });

  return NextResponse.json({ user: data.user });
}

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
  const userId = url.searchParams.get("id") ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Informe ?id=" }, { status: 400 });
  }

  if (userId === guard.user.id) {
    return NextResponse.json(
      { error: "Você não pode deletar seu próprio usuário." },
      { status: 400 },
    );
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

