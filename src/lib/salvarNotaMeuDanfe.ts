import type { SupabaseClient } from "@supabase/supabase-js";
import { importNfeFromMeuDanfe } from "@/lib/meudanfe";
import { asNumberProduto, normalizeDescricaoProduto } from "@/lib/nfeProdutos";

/**
 * Baixa XML via Meu Danfe, faz parse e grava `notas` + `itens_nota` (substitui itens).
 */
export async function salvarNotaViaMeuDanfe(
  admin: SupabaseClient,
  chave: string,
): Promise<{ ok: true; nota: any } | { ok: false; error: string }> {
  const apiKey = (
    process.env.MEUDANFE_API_KEY ??
    process.env.NFE_MEUDANFE ??
    ""
  ).trim();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "MEUDANFE_API_KEY (ou NFE_MEUDANFE) não configurada no servidor.",
    };
  }

  const imported = await importNfeFromMeuDanfe(chave);
  if (!imported) {
    return {
      ok: false,
      error:
        "NFe não encontrada ou ainda indisponível no Meu Danfe. Aguarde e tente novamente.",
    };
  }
  if (!imported.produtos.length) {
    return {
      ok: false,
      error: "XML da NFe sem itens para importar.",
    };
  }

  const { data: notaRow, error: upsertErr } = await admin
    .from("notas")
    .upsert(
      {
        chave_acesso: chave,
        data_emissao: imported.data_emissao,
        payload: imported.payload,
      },
      { onConflict: "chave_acesso" },
    )
    .select()
    .single();

  if (upsertErr) {
    return { ok: false, error: upsertErr.message };
  }

  await admin.from("itens_nota").delete().eq("nota_id", notaRow.id);

  const itensParaSalvar = imported.produtos.map((p) => {
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
    const { error: itensErr } = await admin
      .from("itens_nota")
      .insert(itensParaSalvar);
    if (itensErr) {
      return { ok: false, error: itensErr.message };
    }
  }

  const { data: fullNota, error: loadErr } = await admin
    .from("notas")
    .select("*, itens_nota(*)")
    .eq("id", notaRow.id)
    .single();

  if (loadErr) {
    return { ok: true, nota: notaRow };
  }

  return { ok: true, nota: fullNota };
}
