/**
 * Cliente Meu Danfe API v2 — XML completo da NF-e por chave.
 * @see https://api.meudanfe.com.br/v2
 *
 * Variáveis: MEUDANFE_API_KEY ou NFE_MEUDANFE (server-only).
 * Respeita ≥1,1s entre consultas de status (documentação).
 */

import type { NfeProduto } from "@/lib/nfeProdutos";
import { parseNfeXmlForImport } from "@/lib/nfeProdutos";

const MEUDANFE_BASE = "https://api.meudanfe.com.br/v2";

function getApiKey() {
  return (process.env.MEUDANFE_API_KEY ?? process.env.NFE_MEUDANFE ?? "").trim();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type MeuDanfeStatusResponse = {
  status?: string;
  statusMessage?: string;
  value?: string;
  type?: string;
};

type MeuDanfeXmlResponse = {
  format?: string;
  data?: string;
  status?: string;
};

export type MeuDanfeImportResult = {
  produtos: NfeProduto[];
  data_emissao: string | null;
  payload: Record<string, unknown>;
};

/**
 * Obtém o XML (string) da NFe: GET se já estiver na conta; senão PUT /fd/add e polling.
 */
export async function fetchNfeXmlMeuDanfe(
  chave44: string,
): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey || !/^\d{44}$/.test(chave44)) {
    return null;
  }

  const headers: Record<string, string> = { "Api-Key": apiKey };
  const enc = encodeURIComponent(chave44);

  let r = await fetch(`${MEUDANFE_BASE}/fd/get/xml/${enc}`, { headers });
  let j = (await r.json().catch(() => ({}))) as MeuDanfeXmlResponse;
  if (
    r.ok &&
    typeof j?.data === "string" &&
    j.data.trim().startsWith("<") &&
    j.data.length > 80
  ) {
    return j.data;
  }

  r = await fetch(`${MEUDANFE_BASE}/fd/add/${enc}`, { method: "PUT", headers });
  let pollJson: MeuDanfeStatusResponse = (await r.json().catch(
    () => ({}),
  )) as MeuDanfeStatusResponse;
  if (!r.ok) {
    return null;
  }

  const maxAttempts = 22;
  for (let i = 0; i < maxAttempts; i++) {
    const st = String(pollJson?.status ?? "").toUpperCase();
    if (st === "OK") break;
    if (st === "NOT_FOUND" || st === "ERROR") {
      return null;
    }
    await sleep(1100);
    r = await fetch(`${MEUDANFE_BASE}/fd/add/${enc}`, { method: "PUT", headers });
    pollJson = (await r.json().catch(() => ({}))) as MeuDanfeStatusResponse;
    if (!r.ok) {
      return null;
    }
  }

  if (String(pollJson?.status ?? "").toUpperCase() !== "OK") {
    return null;
  }

  await sleep(1100);
  r = await fetch(`${MEUDANFE_BASE}/fd/get/xml/${enc}`, { headers });
  j = (await r.json().catch(() => ({}))) as MeuDanfeXmlResponse;
  if (!r.ok || typeof j?.data !== "string" || !j.data.trim().startsWith("<")) {
    return null;
  }

  return j.data;
}

/**
 * Importa NFe completa: XML Meu Danfe → produtos + payload jsonb + data de emissão.
 */
export async function importNfeFromMeuDanfe(
  chave44: string,
): Promise<MeuDanfeImportResult | null> {
  const xml = await fetchNfeXmlMeuDanfe(chave44);
  if (!xml) return null;
  const parsed = await parseNfeXmlForImport(xml, chave44);
  return parsed;
}

/** Compat: só a lista de produtos (para código legado que não precise do payload). */
export async function tryFetchProdutosMeuDanfe(
  chave44: string,
): Promise<NfeProduto[]> {
  const r = await importNfeFromMeuDanfe(chave44);
  return r?.produtos ?? [];
}
