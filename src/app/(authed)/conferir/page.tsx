"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { extractHeaderFromNota, fmtDt } from "@/lib/notaHeader";
import { useAuth } from "@/components/AuthContext";

type NotaRow = {
  id: string;
  chave_acesso: string;
  data_emissao: string | null;
  payload: any;
  criado_em: string;
  itens_nota?: { status: string }[];
};

export default function ConferirNotaPage() {
  const { role } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notas, setNotas] = useState<NotaRow[]>([]);

  const sb = getSupabaseClient();

  const carregarNotas = async () => {
    setError(null);
    setLoading(true);
    try {
      if (!sb) throw new Error("Supabase não configurado.");
      const { data, error: err } = await sb
        .from("notas")
        .select("id,chave_acesso,data_emissao,payload,criado_em,itens_nota(status)")
        .order("criado_em", { ascending: false })
        .limit(100);
      if (err) throw err;
      setNotas((data as any[]) ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Erro ao listar notas.");
      setNotas([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregarNotas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apagarNota = async (n: NotaRow) => {
    if (!sb) return;
    const ok = window.confirm(
      `Apagar esta nota da base?\n\nChave: ${n.chave_acesso}\n\nEsta ação não pode ser desfeita.`,
    );
    if (!ok) return;

    setError(null);
    setLoading(true);
    try {
      const { data } = await sb.auth.getSession();
      const access = data.session?.access_token;
      if (!access) throw new Error("Sessão inválida.");

      const r = await fetch(
        `/api/admin/notas?id=${encodeURIComponent(n.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${access}` },
        },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "Falha ao apagar nota.");

      setNotas((prev) => prev.filter((x) => x.id !== n.id));
    } catch (e: any) {
      setError(e?.message ?? "Erro ao apagar nota.");
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
            Notas já salvas na base. Toque para abrir a baixa.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void carregarNotas()}
          disabled={loading}
          className="px-6 py-3 rounded-xl font-bold bg-gray-100 dark:bg-gray-900 disabled:opacity-60"
        >
          {loading ? "Atualizando…" : "Atualizar lista"}
        </button>

        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400 text-center">
            {error}
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        {notas.map((n) => {
          const h = extractHeaderFromNota(n);
          const itens = n.itens_nota ?? [];
          const pend = itens.filter((i) => i.status !== "ENTREGUE").length;
          const border = pend > 0 ? "border-[#FFDF00]" : "border-[#009739]";

          return (
            <div
              key={n.id}
              className={[
                "rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm border-l-8",
                border,
              ].join(" ")}
            >
              <Link
                href={`/operacao?from=conferir&mode=baixa&chave=${encodeURIComponent(
                  n.chave_acesso,
                )}`}
                className="block"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      Cliente
                    </div>
                    <div className="text-2xl font-extrabold">
                      {h.cliente_nome ?? "—"}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      {h.cliente_municipio_uf ?? "—"}
                    </div>
                  </div>

                  <div className="space-y-1 text-sm text-gray-700 dark:text-gray-200">
                    <div>
                      <span className="opacity-70">NFe:</span>{" "}
                      <strong>
                        {h.numero ?? "—"}
                        {h.serie ? ` / Série ${h.serie}` : ""}
                      </strong>
                    </div>
                    <div>
                      <span className="opacity-70">Emissão:</span>{" "}
                      <strong>{fmtDt(h.data_emissao) ?? "—"}</strong>
                    </div>
                    <div className="break-all">
                      <span className="opacity-70">Chave:</span>{" "}
                      <span className="font-mono">{n.chave_acesso}</span>
                    </div>
                    <div>
                      <span className="opacity-70">Pendentes:</span>{" "}
                      <strong>{pend}</strong>
                    </div>
                  </div>
                </div>
              </Link>

              {role === "superadmin" ? (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void apagarNota(n)}
                    disabled={loading}
                    className="px-4 py-2 rounded-xl font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 disabled:opacity-60"
                  >
                    Apagar
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}

        {!notas.length ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60">
            Nenhuma nota salva ainda.
          </div>
        ) : null}
      </div>
    </div>
  );
}

