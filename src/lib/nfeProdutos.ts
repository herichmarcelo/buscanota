/**
 * Parse de XML NFe (nfeProc / NFe) e normalização de itens para o banco.
 * Usado com a integração Meu Danfe (XML autorizado).
 */

import { bestClienteNomeFromDestRecord, coerceXmlTextValue } from "@/lib/notaHeader";

export type NfeProduto = {
  descricao?: string;
  nome?: string;
  xProd?: string;
  produto?: string;
  descricao_produto?: string;
  descricao_completa?: string;
  prod?: any;
  unidade_comercial?: string;
  quantidade_comercial?: string | number;
  unidade?: string;
  quantidade?: string | number;
  qtd?: string | number;
  qCom?: string | number;
  uCom?: string;
};

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function isRecord(x: unknown): x is Record<string, any> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function collectProdNodesDeep(root: any, maxNodes = 50_000) {
  const out: any[] = [];
  const q: any[] = [root];
  let seen = 0;

  while (q.length && seen < maxNodes) {
    const cur = q.shift();
    seen++;
    if (!cur) continue;

    if (isRecord(cur) && cur.det) {
      const detArr = toArray<any>(cur.det);
      for (const d of detArr) {
        const prod = d?.prod ?? d?.produto ?? null;
        if (prod) out.push(prod);
      }
    }

    if (Array.isArray(cur)) {
      for (const v of cur) q.push(v);
      continue;
    }

    if (isRecord(cur)) {
      for (const v of Object.values(cur)) q.push(v);
    }
  }

  return out;
}

/** infNFe a partir do objeto parseado do XML. */
export function getInfNFeFromParsed(obj: any): any | null {
  const root =
    obj?.nfeProc ??
    obj?.NFe ??
    obj?.procNFe ??
    obj?.procEventoNFe ??
    obj?.nfe ??
    obj;
  const nfe = root?.NFe ?? root?.nfeProc?.NFe ?? root?.nfe ?? root;
  const inf =
    nfe?.infNFe ??
    nfe?.NFe?.infNFe ??
    nfe?.nfeProc?.NFe?.infNFe ??
    nfe?.infNFeSupl ??
    nfe?.infNFe;
  return inf ?? null;
}

function extractProdutosFromNfeXmlObject(obj: any): NfeProduto[] {
  const inf = getInfNFeFromParsed(obj);
  const nfe = obj?.nfeProc?.NFe ?? obj?.NFe ?? obj;

  const det = toArray<any>(
    inf?.det ?? nfe?.infNFe?.det ?? nfe?.det ?? obj?.det,
  );
  let prodNodes = det.map((d) => d?.prod ?? d?.produto ?? null).filter(Boolean);

  if (!prodNodes.length) {
    prodNodes = collectProdNodesDeep(obj);
  }

  return (prodNodes ?? []).map((p) => ({
    prod: p,
    xProd: p?.xProd ?? p?.descricao ?? p?.nome ?? null,
    qCom: p?.qCom ?? p?.quantidade_comercial ?? p?.quantidade ?? null,
    uCom: p?.uCom ?? p?.unidade_comercial ?? p?.unidade ?? null,
    ...p,
  })) as NfeProduto[];
}

export async function parseNfeXmlString(xml: string): Promise<NfeProduto[]> {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<") || trimmed.length < 50) return [];
  try {
    const { XMLParser } = await import("fast-xml-parser");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true,
    });
    const obj = parser.parse(trimmed);
    return extractProdutosFromNfeXmlObject(obj);
  } catch {
    return [];
  }
}

/** Payload jsonb para `notas.payload` (compatível com extractHeaderFromNota). */
export function buildMeudanfePayloadFromParsed(obj: any, chave44: string) {
  const inf = getInfNFeFromParsed(obj);
  const dest = inf?.dest;
  const emit = inf?.emit;
  const ide = inf?.ide;

  const nomeDest = bestClienteNomeFromDestRecord(dest);
  const data0 = {
    destinatario: {
      nome: nomeDest,
      nome_razao_social: nomeDest,
      xNome: coerceXmlTextValue(dest?.xNome),
      xFant: coerceXmlTextValue(dest?.xFant),
      cnpj: coerceXmlTextValue(dest?.CNPJ),
      cpf: coerceXmlTextValue(dest?.CPF),
      uf: coerceXmlTextValue(dest?.enderDest?.UF),
      municipio: coerceXmlTextValue(dest?.enderDest?.xMun),
    },
    emitente: {
      nome: coerceXmlTextValue(emit?.xNome) ?? coerceXmlTextValue(emit?.xFant),
      nome_razao_social: coerceXmlTextValue(emit?.xNome),
      nome_fantasia: coerceXmlTextValue(emit?.xFant),
    },
    nfe: {
      numero: ide?.nNF != null ? String(ide.nNF) : null,
      serie: ide?.serie != null ? String(ide.serie) : null,
      data_emissao: ide?.dhEmi ?? null,
      data_hora_da_emissao: ide?.dhEmi ?? null,
    },
  };

  return {
    source: "meudanfe",
    chave_acesso: chave44,
    data: [data0],
  };
}

function normalizeDhEmiToIso(dh?: string | null): string | null {
  if (!dh || typeof dh !== "string") return null;
  const s = dh.trim();
  if (!s) return null;
  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  } catch {
    /* ignore */
  }
  return s;
}

/**
 * Parse único do XML: itens + metadados para gravar nota no Supabase.
 */
export async function parseNfeXmlForImport(
  xml: string,
  chave44: string,
): Promise<{
  produtos: NfeProduto[];
  data_emissao: string | null;
  payload: ReturnType<typeof buildMeudanfePayloadFromParsed>;
} | null> {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<") || trimmed.length < 50) return null;
  try {
    const { XMLParser } = await import("fast-xml-parser");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true,
    });
    const obj = parser.parse(trimmed);
    const produtos = extractProdutosFromNfeXmlObject(obj);
    const payload = buildMeudanfePayloadFromParsed(obj, chave44);
    const inf = getInfNFeFromParsed(obj);
    const dh = inf?.ide?.dhEmi ?? null;
    return {
      produtos,
      data_emissao: normalizeDhEmiToIso(dh),
      payload,
    };
  } catch {
    return null;
  }
}

export function normalizeDescricaoProduto(p: NfeProduto): string {
  const looksTruncatedText = (x: string) => {
    const s = x.trim();
    return /(\.\.\.|…)$/.test(s) || /^.\.{3}$/.test(s);
  };

  const candidatesRaw = [
    p.prod?.xProd,
    p.prod?.descricao,
    p.xProd,
    p.descricao_completa,
    p.descricao_produto,
    p.nome,
    p.produto,
    p.descricao,
  ]
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .map((x) => x.replace(/\s+/g, " "));

  if (!candidatesRaw.length) return "ITEM";

  const notTruncated = candidatesRaw.filter((x) => !looksTruncatedText(x));
  if (notTruncated.length) {
    return notTruncated.sort((a, b) => b.length - a.length)[0];
  }

  return candidatesRaw.sort((a, b) => b.length - a.length)[0];
}

export function asNumberProduto(v: unknown) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim().replace(/\s+/g, "");
    const normalized =
      s.includes(".") && s.includes(",")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
