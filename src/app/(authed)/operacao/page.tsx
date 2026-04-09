import { OperacaoClient } from "./OperacaoClient";

export default async function OperacaoPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; mode?: string; chave?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  return <OperacaoClient search={sp} />;
}

