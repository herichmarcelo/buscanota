"use client";

import { useMemo, useState } from "react";
import { processarChaveNfe } from "@/lib/processarChaveNfe";

type Item = {
  id: string;
  descricao: string;
  unidade: string;
  quantidade_total: number;
  quantidade_entregue: number;
  status: "PENDENTE" | "PARCIAL" | "ENTREGUE";
};

export default function ConferirNotaPage() {
  const [chave, setChave] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itens, setItens] = useState<Item[]>([]);

  const pendentes = useMemo(
    () => itens.filter((i) => i.status !== "ENTREGUE").length,
    [itens],
  );

  const buscar = async () => {
    setError(null);
    setLoading(true);
    try {
      const res: any = await processarChaveNfe(chave);
      const itensNota = (res?.itens_nota ??
        res?.itens_nota?.data ??
        res?.itens_nota) as Item[] | undefined;
      setItens(
        (itensNota ?? []).map((x: any) => ({
          id: String(x.id ?? crypto.randomUUID()),
          descricao: String(x.descricao ?? ""),
          unidade: String(x.unidade ?? ""),
          quantidade_total: Number(x.quantidade_total ?? 0),
          quantidade_entregue: Number(x.quantidade_entregue ?? 0),
          status: (x.status ?? "PENDENTE") as Item["status"],
        })),
      );
    } catch (e: any) {
      setError(e?.message ?? "Erro ao buscar nota.");
      setItens([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border-t-4 border-[#009739]">
        <div className="space-y-1 mb-4">
          <h1 className="text-3xl font-bold">Conferir nota</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {itens.length
              ? `${itens.length} item(ns) • ${pendentes} pendente(s)`
              : "Consulte uma chave para ver o status dos itens."}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            inputMode="numeric"
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            placeholder="Digite/cole a chave (44 dígitos)"
            className="flex-1 p-4 text-xl border-2 border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:border-[#009739] focus:outline-none"
          />
          <button
            type="button"
            onClick={buscar}
            disabled={loading}
            className="px-6 py-4 rounded-xl font-bold bg-[#009739] text-white active:bg-[#007a2e] disabled:opacity-60 transition"
          >
            {loading ? "Buscando…" : "Buscar"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400 text-center">
            {error}
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        {itens.map((item) => {
          const entregue = item.status === "ENTREGUE";
          return (
            <div
              key={item.id}
              className={[
                "rounded-2xl p-6 shadow-md border-l-8 bg-white dark:bg-gray-800",
                entregue ? "border-[#009739] opacity-90" : "border-[#FFDF00]",
              ].join(" ")}
            >
              <h3 className="text-xl font-bold">{item.descricao}</h3>
              <p className="mt-2 text-lg opacity-80">
                Comprado:{" "}
                <strong>
                  {item.quantidade_total} {item.unidade}
                </strong>{" "}
                • Entregue:{" "}
                <strong>
                  {item.quantidade_entregue} {item.unidade}
                </strong>
              </p>
              <div className="mt-3">
                {entregue ? (
                  <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 text-[#009739] dark:text-green-300 px-4 py-2 font-bold">
                    ✓ Entregue
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-gray-900 dark:text-yellow-200 px-4 py-2 font-bold">
                    {item.status}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {!itens.length ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60">
            Nenhum dado para exibir ainda.
          </div>
        ) : null}
      </div>
    </div>
  );
}

