"use client";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthContext";
import { useEffect, useMemo, useState } from "react";

type Evento = {
  id: string;
  chave_acesso: string;
  user_id: string;
  tipo: "LEITURA" | "ENTREGA";
  payload: any;
  created_at: string;
};

function formatDt(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

export default function RelatoriosPage() {
  const { role } = useAuth();
  const sb = getSupabaseClient();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);

  const grouped = useMemo(() => {
    const map = new Map<string, Evento[]>();
    for (const ev of eventos) {
      const list = map.get(ev.chave_acesso) ?? [];
      list.push(ev);
      map.set(ev.chave_acesso, list);
    }
    return [...map.entries()].map(([chave, list]) => {
      const leitura = list.find((x) => x.tipo === "LEITURA");
      const entregas = list.filter((x) => x.tipo === "ENTREGA");
      const lastEntrega = entregas[0];
      return { chave, leitura, entregas, lastEntrega };
    });
  }, [eventos]);

  const fetchEventos = async () => {
    setError(null);
    setLoading(true);
    try {
      if (!sb) throw new Error("Supabase não configurado.");
      const q = sb
        .from("nfe_eventos")
        .select("id,chave_acesso,user_id,tipo,payload,created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      const { data, error: err } = await q;
      if (err) throw err;
      setEventos((data as Evento[]) ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Erro ao carregar relatório.");
      setEventos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEventos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm border-t-4 border-[#009739]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Relatórios</h1>
            <p className="mt-2 text-gray-600 dark:text-gray-300">
              {role === "superadmin"
                ? "Superadmin vê todas as leituras/entregas."
                : "Você vê apenas suas leituras/entregas."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchEventos()}
            disabled={loading}
            className="px-6 py-3 rounded-xl font-bold bg-gray-100 dark:bg-gray-900 disabled:opacity-60"
          >
            {loading ? "Carregando…" : "Atualizar"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>

      <div className="grid gap-4">
        {grouped.map((g) => (
          <div
            key={g.chave}
            className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm border-l-8 border-[#FFDF00]"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  Chave
                </div>
                <div className="font-mono text-lg break-all">{g.chave}</div>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Leituras: <strong>{g.leitura ? 1 : 0}</strong> • Entregas:{" "}
                <strong>{g.entregas.length}</strong>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-gray-50 dark:bg-gray-900 p-4">
                <div className="text-sm opacity-70">Dia/Hora da leitura</div>
                <div className="text-lg font-bold">
                  {g.leitura ? formatDt(g.leitura.created_at) : "—"}
                </div>
              </div>

              <div className="rounded-2xl bg-gray-50 dark:bg-gray-900 p-4">
                <div className="text-sm opacity-70">
                  Última entrega registrada
                </div>
                <div className="text-lg font-bold">
                  {g.lastEntrega ? formatDt(g.lastEntrega.created_at) : "—"}
                </div>
              </div>
            </div>

            {g.lastEntrega?.payload ? (
              <div className="mt-4 rounded-2xl bg-[#009739]/10 dark:bg-[#009739]/15 p-4">
                <div className="text-sm opacity-70">Última ação</div>
                <div className="text-lg font-bold">
                  {String(g.lastEntrega.payload?.descricao ?? "Item")} •{" "}
                  {String(g.lastEntrega.payload?.de ?? "—")} →{" "}
                  {String(g.lastEntrega.payload?.para ?? "—")}
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {!grouped.length ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60">
            Sem eventos ainda. Faça uma leitura/entrega na operação para gerar
            relatório.
          </div>
        ) : null}
      </div>
    </div>
  );
}

