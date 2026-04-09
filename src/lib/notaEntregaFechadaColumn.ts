import type { SupabaseClient } from "@supabase/supabase-js";

/** Erros PostgREST/Postgres quando a coluna ainda não foi criada no banco. */
export function isMissingEntregaFechadaColumn(message: string | undefined | null) {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("entrega_fechada") &&
    (m.includes("does not exist") ||
      m.includes("could not find") ||
      m.includes("unknown column") ||
      m.includes("schema cache"))
  );
}

/**
 * Lê o flag entrega_fechada; se a coluna não existir, devolve fechada=false (e o caller pode avisar migração).
 */
export async function readNotaEntregaFechada(
  admin: SupabaseClient,
  notaId: string,
): Promise<{ fechada: boolean; error: string | null }> {
  const { data, error } = await admin
    .from("notas")
    .select("entrega_fechada")
    .eq("id", notaId)
    .maybeSingle();

  if (!error) {
    return { fechada: Boolean((data as { entrega_fechada?: boolean } | null)?.entrega_fechada), error: null };
  }
  if (isMissingEntregaFechadaColumn(error.message)) {
    return { fechada: false, error: null };
  }
  return { fechada: false, error: error.message };
}
