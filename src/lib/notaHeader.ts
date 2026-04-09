export type NotaHeader = {
  chave_acesso: string;
  data_emissao?: string | null;
  cliente_nome?: string | null;
  cliente_doc?: string | null;
  cliente_municipio_uf?: string | null;
  emitente_nome?: string | null;
  numero?: string | null;
  serie?: string | null;
};

function pick(obj: any, path: string) {
  return path.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
}

/** Valor textual vindo do fast-xml-parser (string, #text, número). */
export function coerceXmlTextValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const s = String(v);
    return s.length ? s : null;
  }
  if (typeof v === "string") {
    const t = v.trim().replace(/\s+/g, " ");
    return t.length ? t : null;
  }
  if (typeof v === "object" && v !== null && "#text" in v) {
    return coerceXmlTextValue((v as { "#text": unknown })["#text"]);
  }
  return null;
}

/** Nome aparentemente censurado (ex.: MAUR*** da consulta resumida). */
function looksLikeMaskedNome(s: string) {
  return /\*{2,}/.test(s) || /^.{1,8}\*{1,}$/.test(s.trim());
}

/**
 * Escolhe o melhor nome do destinatário a partir de um objeto (payload/XML parseado).
 */
export function bestClienteNomeFromDestRecord(dest: any): string | null {
  if (!dest || typeof dest !== "object") return null;
  const cands: string[] = [];
  const push = (v: unknown) => {
    const s = coerceXmlTextValue(v);
    if (s && s.length >= 2) cands.push(s);
  };
  push(dest.nome);
  push(dest.nome_razao_social);
  push(dest.nome_razao_social_destinatario);
  push(dest.normalizado_nome);
  push(dest.xNome);
  push(dest.XNome);
  push(dest.xFant);
  push(dest.XFant);
  const uniq = [...new Set(cands)];
  if (!uniq.length) return null;
  const unmasked = uniq.filter((s) => !looksLikeMaskedNome(s));
  const pool = unmasked.length ? unmasked : uniq;
  return pool.reduce((a, b) => (a.length >= b.length ? a : b));
}

function bestClienteNomeFromDestBlocks(blocks: any[]): string | null {
  const names = blocks
    .map((b) => bestClienteNomeFromDestRecord(b))
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  if (!names.length) return null;
  const unmasked = names.filter((s) => !looksLikeMaskedNome(s));
  const pool = unmasked.length ? unmasked : names;
  return pool.reduce((a, b) => (a.length >= b.length ? a : b));
}

export function fmtDoc(doc?: string | null) {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 11)
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (d.length === 14)
    return d.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5",
    );
  return doc ?? null;
}

export function fmtDt(iso?: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

export function extractHeaderFromNota(nota: any): NotaHeader {
  const payload = nota?.payload ?? null;
  const data0 = Array.isArray(payload?.data) ? payload.data[0] : payload?.data ?? null;

  const destBlocks = [
    pick(data0, "destinatario"),
    pick(data0, "dest"),
    pick(data0, "nfe.dest"),
    pick(data0, "nfe.destinatario"),
    pick(data0, "nfe_completa.destinatario"),
    pick(data0, "nfe_completa.nfe.dest"),
    pick(data0, "nfe_completa.nfe.destinatario"),
    pick(data0, "resumida.destinatario"),
  ].filter((x) => x && typeof x === "object");

  const dest =
    destBlocks.find(
      (d) =>
        d &&
        (d.cnpj ||
          d.CNPJ ||
          d.cpf ||
          d.CPF ||
          d.nome ||
          d.xNome ||
          d.nome_razao_social),
    ) ??
    destBlocks[0] ??
    null;

  const emit =
    pick(data0, "emitente") ??
    pick(data0, "nfe.emitente") ??
    pick(data0, "nfe_completa.emitente") ??
    pick(data0, "nfe_completa.nfe.emit") ??
    pick(data0, "emit");

  const clienteNome = bestClienteNomeFromDestBlocks(destBlocks);

  const clienteDoc = fmtDoc(
    coerceXmlTextValue(dest?.cnpj) ??
      coerceXmlTextValue(dest?.CNPJ) ??
      coerceXmlTextValue(dest?.cpf) ??
      coerceXmlTextValue(dest?.CPF) ??
      dest?.normalizado_cnpj ??
      dest?.normalizado_cpf ??
      null,
  );
  const clienteUf =
    coerceXmlTextValue(dest?.uf) ??
    coerceXmlTextValue(dest?.enderDest?.UF) ??
    null;
  const clienteMunicipio =
    coerceXmlTextValue(dest?.municipio) ??
    coerceXmlTextValue(dest?.enderDest?.xMun) ??
    dest?.normalizado_municipio ??
    null;

  const emitNome =
    coerceXmlTextValue(emit?.nome) ??
    coerceXmlTextValue(emit?.xNome) ??
    coerceXmlTextValue(emit?.nome_razao_social) ??
    coerceXmlTextValue(emit?.nome_fantasia) ??
    coerceXmlTextValue(emit?.xFant) ??
    null;

  const numero =
    String(
      pick(data0, "numero") ??
        pick(data0, "nfe.numero") ??
        pick(data0, "nfe_completa.numero") ??
        "",
    ) || null;
  const serie =
    String(
      pick(data0, "serie") ??
        pick(data0, "nfe.serie") ??
        pick(data0, "nfe_completa.serie") ??
        "",
    ) || null;

  const dataEmissao =
    nota?.data_emissao ??
    pick(data0, "data_emissao") ??
    pick(data0, "nfe.data_emissao") ??
    pick(data0, "nfe.data_hora_da_emissao") ??
    null;

  return {
    chave_acesso: String(nota?.chave_acesso ?? ""),
    data_emissao: typeof dataEmissao === "string" ? dataEmissao : null,
    cliente_nome: clienteNome,
    cliente_doc: clienteDoc,
    cliente_municipio_uf:
      clienteMunicipio && clienteUf ? `${clienteMunicipio} - ${clienteUf}` : null,
    emitente_nome: emitNome,
    numero,
    serie,
  };
}

