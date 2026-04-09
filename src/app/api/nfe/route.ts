import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chave = url.searchParams.get("chave")?.trim() ?? "";

  if (!/^\d{44}$/.test(chave)) {
    return NextResponse.json(
      { error: "Chave inválida. Esperado 44 dígitos." },
      { status: 400 },
    );
  }

  // Mock (substitua por integração real com SEFAZ/terceiros).
  return NextResponse.json({
    chave_acesso: chave,
    data_emissao: new Date().toISOString(),
    produtos: [
      {
        nome: "RACAO POEDEIRA POSTURA IGUAPHOS 30 KG SACO",
        unidade: "SC",
        qtd: 3,
      },
      {
        nome: "CORDA TRANCADA POLIPROPILENO PP 10,0 MM - METRO",
        unidade: "M",
        qtd: 10,
      },
    ],
  });
}

