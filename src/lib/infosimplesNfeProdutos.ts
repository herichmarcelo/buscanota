/**
 * Extração de itens da resposta Infosimples (consulta NFe).
 *
 * Documentação (Receita Federal / NFe): em geral os itens completos vêm em
 * `data[0].nfe_completa.produtos[]` com campo `descricao`. Quando a nota vem
 * só resumida, `data[0].resumida.produtos[]` costuma trazer textos truncados
 * (ex.: "T..."). Por isso coletamos todas as listas candidatas e escolhemos a
 * que tiver descrições mais longas, com desempate favorecendo `nfe_completa`.
 *
 * @see https://infosimples.com/consultas/receita-federal-nfe/
 */

export type InfosimplesProduto = {
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

function pick(obj: any, path: string) {
  return path.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
}

function firstArray(...vals: unknown[]): any[] {
  for (const v of vals) if (Array.isArray(v) && v.length) return v;
  return [];
}

/** Maior comprimento entre campos de texto candidatos (sem normalizar). */
function rawDescMaxLen(p: InfosimplesProduto): number {
  const candidates = [
    p.prod?.xProd,
    p.prod?.descricao,
    p.xProd,
    p.descricao_completa,
    p.descricao_produto,
    p.nome,
    p.produto,
    p.descricao,
  ].filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  if (!candidates.length) return 0;
  return Math.max(...candidates.map((s) => s.trim().length));
}

function scoreProdutoList(arr: InfosimplesProduto[]): number {
  return arr.reduce((acc, p) => acc + rawDescMaxLen(p), 0);
}

function isLikelyProdutoRow(x: unknown): x is Record<string, unknown> {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.descricao === "string" ||
    typeof o.xProd === "string" ||
    o.quantidade_comercial != null ||
    o.qCom != null ||
    o.qtd != null
  );
}

/**
 * Retorna a melhor lista de produtos encontrada no JSON bruto da Infosimples.
 */
export function extractProdutosFromInfosimplesPayload(
  payload: any,
): InfosimplesProduto[] {
  const data0 = Array.isArray(payload?.data)
    ? payload.data[0]
    : payload?.data ?? null;

  type Entry = { arr: InfosimplesProduto[]; prefer: number };
  const entries: Entry[] = [];

  const push = (arr: unknown, prefer: number) => {
    if (!Array.isArray(arr) || !arr.length) return;
    if (!isLikelyProdutoRow(arr[0])) return;
    entries.push({ arr: arr as InfosimplesProduto[], prefer });
  };

  // Ordem de preferência em empate de score (maior = melhor).
  // `resumida` fica propositalmente com peso menor.
  push(pick(data0, "nfe_completa.produtos"), 100);
  push(pick(data0, "nfe_completa.nfe.produtos"), 98);
  push(pick(data0, "nfe_completa.nfe_completa.produtos"), 98);
  push(pick(data0, "nfe_completa.itens"), 96);
  push(pick(data0, "nfe.produtos"), 60);
  push(pick(data0, "produtos"), 55);
  push(pick(payload, "produtos"), 50);
  push(pick(data0, "resumida.produtos"), 15);

  // NFe XML: det[].prod
  const det = firstArray(
    pick(data0, "nfe_completa.nfe.det"),
    pick(data0, "nfe_completa.nfe_completa.nfe.det"),
    pick(data0, "nfe.det"),
    pick(data0, "det"),
  ) as any[];

  const viaDet = (det ?? [])
    .map((d) => d?.prod ?? d?.produto ?? d)
    .filter(Boolean)
    .map((p) => ({
      ...(typeof p === "object" ? p : {}),
      prod: p,
      xProd: (p?.xProd ?? p?.descricao ?? p?.nome ?? null) as any,
      qCom: (p?.qCom ?? p?.quantidade_comercial ?? p?.quantidade ?? null) as any,
      uCom: (p?.uCom ?? p?.unidade_comercial ?? p?.unidade ?? null) as any,
    })) as InfosimplesProduto[];

  if (viaDet.length && isLikelyProdutoRow(viaDet[0])) {
    entries.push({ arr: viaDet, prefer: 97 });
  }

  if (!entries.length) return [];

  entries.sort((a, b) => {
    const sa = scoreProdutoList(a.arr);
    const sb = scoreProdutoList(b.arr);
    if (sb !== sa) return sb - sa;
    return b.prefer - a.prefer;
  });

  return entries[0].arr;
}

export function normalizeDescricaoProduto(p: InfosimplesProduto): string {
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

  const looksTruncated = (x: string) =>
    /(\.\.\.|…)$/.test(x) || /^.\.{3}$/.test(x);

  const notTruncated = candidatesRaw.filter((x) => !looksTruncated(x));
  if (notTruncated.length) {
    return notTruncated.sort((a, b) => b.length - a.length)[0];
  }

  return candidatesRaw.sort((a, b) => b.length - a.length)[0];
}

export function asNumberProduto(v: unknown) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
