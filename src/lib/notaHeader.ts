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

  const dest =
    pick(data0, "destinatario") ??
    pick(data0, "nfe.destinatario") ??
    pick(data0, "nfe_completa.destinatario");
  const emit =
    pick(data0, "emitente") ??
    pick(data0, "nfe.emitente") ??
    pick(data0, "nfe_completa.emitente");

  const clienteNome =
    dest?.nome ??
    dest?.nome_razao_social ??
    dest?.nome_razao_social_destinatario ??
    null;
  const clienteDoc = fmtDoc(
    dest?.cnpj ?? dest?.cpf ?? dest?.normalizado_cnpj ?? dest?.normalizado_cpf ?? null,
  );
  const clienteUf = dest?.uf ?? null;
  const clienteMunicipio = dest?.municipio ?? dest?.normalizado_municipio ?? null;

  const emitNome =
    emit?.nome ?? emit?.nome_razao_social ?? emit?.nome_fantasia ?? null;

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

