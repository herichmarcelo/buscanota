import { getSupabaseClient } from "@/lib/supabaseClient";

type ApiProduto = {
  nome: string;
  unidade?: string;
  qtd: number;
};

type ApiNota = {
  chave_acesso: string;
  data_emissao: string;
  produtos: ApiProduto[];
};

async function buscarNotaNaApiExterna(chave: string): Promise<{
  nota: any;
  itens: any[];
}> {
  // Fluxo assíncrono: cria job e a UI faz polling até concluir.
  const res = await fetch("/api/nfe-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chave }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error ?? `Falha ao consultar API: ${res.status}`);
  }
  return { nota: json.nota ?? null, itens: json.itens ?? [] };
}

export async function processarChaveNfe(chaveInput: string) {
  const chave = chaveInput.trim();
  if (!/^\d{44}$/.test(chave)) {
    throw new Error("Chave inválida. Esperado 44 dígitos.");
  }

  const sb = getSupabaseClient();
  if (!sb) {
    // Sem Supabase no client: ainda permite testar UI usando mock.
    const res = await fetch(`/api/nfe?chave=${encodeURIComponent(chave)}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Falha ao consultar API: ${res.status} ${text}`);
    }
    const apiNota = (await res.json()) as ApiNota;
    return {
      modo: "sem_supabase" as const,
      nota: {
        id: "mock",
        chave_acesso: apiNota.chave_acesso,
        data_emissao: apiNota.data_emissao,
      },
      itens_nota: apiNota.produtos.map((p, idx) => ({
        id: `mock-${idx + 1}`,
        descricao: p.nome,
        unidade: p.unidade ?? "",
        quantidade_total: p.qtd,
        quantidade_entregue: 0,
        status: "PENDENTE" as const,
      })),
    };
  }

  // 1) Cache: tenta achar no Supabase primeiro
  const { data: notaLocal, error: selectErr } = await sb
    .from("notas")
    .select("*, itens_nota(*)")
    .eq("chave_acesso", chave)
    .maybeSingle();

  if (selectErr) throw selectErr;
  if (notaLocal) {
    return { modo: "cache" as const, ...notaLocal };
  }

  // 2) Busca na API externa
  const { nota, itens } = await buscarNotaNaApiExterna(chave);

  // Já devolve o que veio do server (economiza um roundtrip no Supabase)
  // `nota` pode vir como registro completo com `itens_nota(*)` (cache) ou só "capa".
  if (nota?.itens_nota) return { modo: "api" as const, ...nota };
  return { modo: "api" as const, ...nota, itens_nota: itens };
}

