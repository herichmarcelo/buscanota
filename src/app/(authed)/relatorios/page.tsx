"use client";

import { FileDown } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthContext";
import {
  downloadPdfRelatorioEntregasDia,
  downloadPdfRelatorioFechamento,
  type ItemRelatorioPdf,
} from "@/lib/pdfRelatorioEntregas";
import type { NotaHeader } from "@/lib/notaHeader";
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

/** YYYY-MM-DD no fuso America/São Paulo (relatório “do dia”). */
function dataCalendarioSaoPaulo(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function diaPtBrReferencia(iso: string) {
  const ymd = dataCalendarioSaoPaulo(iso);
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function mapSnapshotToPdfItens(raw: unknown): ItemRelatorioPdf[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row: Record<string, unknown>) => ({
    descricao: String(row.descricao ?? ""),
    unidade: String(row.unidade ?? ""),
    quantidade_total: Number(row.quantidade_total ?? 0),
    quantidade_entregue: Number(row.quantidade_entregue ?? 0),
    saldo_restante: Number(row.saldo_restante ?? 0),
    status: String(row.status ?? ""),
    ultima_retirada_em: (row.ultima_retirada_em as string | null) ?? null,
  }));
}

export default function RelatoriosPage() {
  const { role } = useAuth();
  const sb = getSupabaseClient();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [pdfChaveLoading, setPdfChaveLoading] = useState<string | null>(null);
  const [pdfFechamentoId, setPdfFechamentoId] = useState<string | null>(null);

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

  const gerarPdfEntregasDoDia = async (chave: string, diaIsoReferencia: string) => {
    if (!sb) {
      setError("Supabase não configurado.");
      return;
    }
    const dia = dataCalendarioSaoPaulo(diaIsoReferencia);
    setPdfChaveLoading(chave);
    setError(null);
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError("Sessão expirada. Entre novamente.");
        return;
      }
      const r = await fetch(
        `/api/relatorio-entregas-dia?chave=${encodeURIComponent(chave)}&dia=${encodeURIComponent(dia)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error ?? "Falha ao montar relatório.");
        return;
      }
      const itens: ItemRelatorioPdf[] = (j.itens ?? []).map((row: any) => ({
        descricao: String(row.descricao ?? ""),
        unidade: String(row.unidade ?? ""),
        quantidade_total: Number(row.quantidade_total ?? 0),
        quantidade_entregue: Number(row.quantidade_entregue ?? 0),
        saldo_restante: Number(row.saldo_restante ?? 0),
        status: String(row.status ?? ""),
        ultima_retirada_em: row.ultima_retirada_em ?? null,
      }));
      downloadPdfRelatorioEntregasDia({
        notaCapa: j.nota,
        dia: j.dia,
        itens,
        geradoEmIso: new Date().toISOString(),
      });
    } catch {
      setError("Falha de rede ao gerar PDF.");
    } finally {
      setPdfChaveLoading(null);
    }
  };

  const gerarPdfFechamento = (
    chave: string,
    ev: Evento,
    capa: NotaHeader | null,
    itens: ItemRelatorioPdf[],
  ) => {
    const fechadoEm =
      (ev.payload?.fechado_em as string | undefined) ?? ev.created_at;
    const capaSafe: NotaHeader = capa?.chave_acesso
      ? capa
      : { chave_acesso: chave };
    setPdfFechamentoId(ev.id);
    try {
      downloadPdfRelatorioFechamento({
        capa: capaSafe,
        itens,
        fechadoEmIso: fechadoEm,
        geradoEmIso: new Date().toISOString(),
      });
    } finally {
      setPdfFechamentoId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm border-t-4 border-[#009739]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Relatórios</h1>
            <p className="mt-2 text-gray-600 dark:text-gray-300">
              {role === "superadmin"
                ? "Superadmin vê todas as leituras, fechamentos de entrega e PDFs."
                : "Você vê apenas seus eventos; fechamentos ficam gravados com snapshot dos itens."}
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
        {grouped.map((g) => {
          const fechamentos = g.entregas
            .filter((e) => e.payload?.acao === "fechar_entrega")
            .sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
            );
          return (
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

            {g.lastEntrega ? (
              <div className="mt-4 rounded-2xl bg-[#009739]/10 dark:bg-[#009739]/15 p-4 space-y-3">
                {g.lastEntrega.payload &&
                (g.lastEntrega.payload.descricao != null ||
                  g.lastEntrega.payload.de != null ||
                  g.lastEntrega.payload.para != null) ? (
                  <div>
                    <div className="text-sm opacity-70">Última ação</div>
                    <div className="text-lg font-bold">
                      {String(g.lastEntrega.payload?.descricao ?? "Item")} •{" "}
                      {String(g.lastEntrega.payload?.de ?? "—")} →{" "}
                      {String(g.lastEntrega.payload?.para ?? "—")}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Gere o PDF com os <strong>itens entregues</strong> (dados da
                    nota) cuja <strong>última retirada</strong> cai no dia{" "}
                    <strong>{diaPtBrReferencia(g.lastEntrega.created_at)}</strong>{" "}
                    (fuso America/São Paulo), para esta chave.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void gerarPdfEntregasDoDia(
                        g.chave,
                        g.lastEntrega!.created_at,
                      )
                    }
                    disabled={pdfChaveLoading === g.chave}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#009739] px-5 py-3 font-bold text-white shadow-sm transition hover:bg-[#007a2e] disabled:opacity-60"
                  >
                    <FileDown className="h-5 w-5" />
                    {pdfChaveLoading === g.chave
                      ? "Gerando…"
                      : "Gerar PDF do dia"}
                  </button>
                </div>
              </div>
            ) : null}

            {fechamentos.length > 0 ? (
              <div className="mt-6 space-y-6">
                <div className="text-sm font-extrabold uppercase tracking-wide text-[#005c2e] dark:text-[#4ade80]">
                  Relatórios de fechamento (conferência)
                </div>
                {fechamentos.map((ev) => {
                  const capa = (ev.payload?.nota_resumo ?? null) as NotaHeader | null;
                  const itensPdf = mapSnapshotToPdfItens(ev.payload?.itens);
                  const rows = Array.isArray(ev.payload?.itens)
                    ? (ev.payload.itens as Record<string, unknown>[])
                    : [];
                  return (
                    <div
                      key={ev.id}
                      className="rounded-2xl border-2 border-[#005c2e]/40 dark:border-[#4ade80]/30 bg-white dark:bg-gray-900/80 p-4 shadow-inner"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Fechamento registrado
                          </div>
                          <div className="text-lg font-bold">
                            {formatDt(ev.created_at)}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                            {itensPdf.length} item(ns) no snapshot gravado no banco.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            gerarPdfFechamento(g.chave, ev, capa, itensPdf)
                          }
                          disabled={pdfFechamentoId === ev.id}
                          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#005c2e] px-5 py-3 font-bold text-white shadow-sm transition hover:bg-[#004724] disabled:opacity-60"
                        >
                          <FileDown className="h-5 w-5" />
                          {pdfFechamentoId === ev.id
                            ? "Gerando…"
                            : "PDF para conferência"}
                        </button>
                      </div>
                      {rows.length > 0 ? (
                        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                          <table className="min-w-full text-sm">
                            <thead className="bg-gray-100 dark:bg-gray-800 text-left">
                              <tr>
                                <th className="px-3 py-2 font-bold">#</th>
                                <th className="px-3 py-2 font-bold">Descrição</th>
                                <th className="px-3 py-2 font-bold">Un.</th>
                                <th className="px-3 py-2 font-bold">Total</th>
                                <th className="px-3 py-2 font-bold">Entregue</th>
                                <th className="px-3 py-2 font-bold">Saldo</th>
                                <th className="px-3 py-2 font-bold">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                              {rows.map((row, idx) => (
                                <tr
                                  key={String(row.id ?? idx)}
                                  className="bg-white dark:bg-gray-900"
                                >
                                  <td className="px-3 py-2 font-mono text-gray-500">
                                    {String(idx + 1).padStart(2, "0")}
                                  </td>
                                  <td className="px-3 py-2 max-w-[220px] break-words">
                                    {String(row.descricao ?? "")}
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    {String(row.unidade ?? "—")}
                                  </td>
                                  <td className="px-3 py-2 tabular-nums">
                                    {String(row.quantidade_total ?? "")}
                                  </td>
                                  <td className="px-3 py-2 tabular-nums">
                                    {String(row.quantidade_entregue ?? "")}
                                  </td>
                                  <td className="px-3 py-2 tabular-nums">
                                    {String(row.saldo_restante ?? "")}
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    {String(row.status ?? "")}
                                    {Boolean(row.parcial_confirmada) ? (
                                      <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">
                                        (parcial conf.)
                                      </span>
                                    ) : null}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          );
        })}

        {!grouped.length ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60">
            Sem eventos ainda. Use Operação para ler a nota e, ao fechar a
            entrega, o relatório de conferência aparece aqui automaticamente.
          </div>
        ) : null}
      </div>
    </div>
  );
}

