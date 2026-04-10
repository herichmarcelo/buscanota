"use client";

import { ChevronDown, FileDown } from "lucide-react";
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

function chaveResumo(chave: string) {
  if (chave.length <= 20) return chave;
  return `${chave.slice(0, 8)}…${chave.slice(-6)}`;
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

function SnapshotItemMobile({
  row,
  idx,
}: {
  row: Record<string, unknown>;
  idx: number;
}) {
  const status = String(row.status ?? "");
  const parcial = Boolean(row.parcial_confirmada);
  const ultima = row.ultima_retirada_em;
  const ultimaStr =
    typeof ultima === "string" && ultima
      ? formatDt(ultima)
      : "—";
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/90 dark:bg-gray-800/80 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-mono font-bold text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 px-2 py-0.5 rounded-md">
          #{String(idx + 1).padStart(2, "0")}
        </span>
        <span className="text-[11px] font-bold uppercase text-right text-[#005c2e] dark:text-[#4ade80] max-w-[55%] leading-tight">
          {status}
          {parcial ? (
            <span className="block text-amber-700 dark:text-amber-300 font-semibold normal-case mt-0.5">
              Parcial confirmada
            </span>
          ) : null}
        </span>
      </div>
      <p className="text-sm font-extrabold leading-snug text-gray-900 dark:text-gray-100">
        {String(row.descricao ?? "—")}
      </p>
      <div className="grid grid-cols-4 gap-1.5 text-center rounded-lg bg-white/80 dark:bg-gray-900/60 p-2 ring-1 ring-gray-200/70 dark:ring-gray-600/50">
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase text-gray-500">Un.</div>
          <div className="text-xs font-black truncate">
            {String(row.unidade ?? "—")}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase text-gray-500">Tot.</div>
          <div className="text-xs font-black tabular-nums">
            {String(row.quantidade_total ?? "")}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase text-gray-500">Ent.</div>
          <div className="text-xs font-black tabular-nums">
            {String(row.quantidade_entregue ?? "")}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase text-gray-500">Saldo</div>
          <div className="text-xs font-black tabular-nums text-amber-700 dark:text-amber-300">
            {String(row.saldo_restante ?? "")}
          </div>
        </div>
      </div>
      <div className="text-[10px] text-gray-600 dark:text-gray-400">
        <span className="font-bold uppercase text-gray-500">Últ. retirada</span>{" "}
        <span className="font-semibold text-gray-800 dark:text-gray-200">
          {ultimaStr}
        </span>
      </div>
    </div>
  );
}

export default function RelatoriosPage() {
  const { role } = useAuth();
  const sb = getSupabaseClient();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [pdfChaveLoading, setPdfChaveLoading] = useState<string | null>(null);
  const [pdfFechamentoId, setPdfFechamentoId] = useState<string | null>(null);
  const [chaveExpandida, setChaveExpandida] = useState<Record<string, boolean>>(
    {},
  );

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

  const gerarPdfEntregasDoDia = async (
    chave: string,
    diaIsoReferencia: string,
  ) => {
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
    <div className="max-w-5xl mx-auto space-y-4 md:space-y-6 px-3 sm:px-4 md:px-0 pb-8 md:pb-0">
      <div className="rounded-2xl bg-white dark:bg-gray-800 p-4 md:p-6 shadow-sm border-t-4 border-[#009739]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Relatórios
            </h1>
            <p className="mt-2 text-sm md:text-base text-gray-600 dark:text-gray-300 leading-relaxed">
              <span className="md:hidden">
                PDFs e histórico por nota. Toque em uma chave para ver detalhes.
              </span>
              <span className="hidden md:inline">
                {role === "superadmin"
                  ? "Superadmin vê todas as leituras, fechamentos de entrega e PDFs."
                  : "Você vê apenas seus eventos; fechamentos ficam gravados com snapshot dos itens."}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchEventos()}
            disabled={loading}
            className="w-full md:w-auto shrink-0 inline-flex items-center justify-center px-6 py-3.5 md:py-3 rounded-xl font-bold bg-gray-100 dark:bg-gray-900 disabled:opacity-60 active:scale-[0.99]"
          >
            {loading ? "Carregando…" : "Atualizar lista"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400 rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2">
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 md:gap-4">
        {grouped.map((g) => {
          const fechamentos = g.entregas
            .filter((e) => e.payload?.acao === "fechar_entrega")
            .sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
            );
          const chaveAberta = chaveExpandida[g.chave] ?? false;
          return (
            <div
              key={g.chave}
              className="rounded-2xl bg-white dark:bg-gray-800 p-4 md:p-6 shadow-md md:shadow-sm border-l-4 md:border-l-8 border-[#FFDF00]"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold uppercase tracking-wide text-[#005c2e] dark:text-[#4ade80]">
                    Chave de acesso
                  </div>
                  <button
                    type="button"
                    className="mt-1 w-full text-left md:pointer-events-none md:cursor-default"
                    onClick={() =>
                      setChaveExpandida((prev) => ({
                        ...prev,
                        [g.chave]: !prev[g.chave],
                      }))
                    }
                    aria-expanded={chaveAberta}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-sm md:text-lg break-all text-gray-900 dark:text-gray-100 leading-snug">
                        <span className="md:hidden">
                          {chaveAberta ? g.chave : chaveResumo(g.chave)}
                        </span>
                        <span className="hidden md:inline">{g.chave}</span>
                      </span>
                      <ChevronDown
                        className={`h-5 w-5 shrink-0 text-gray-500 transition-transform md:hidden ${
                          chaveAberta ? "rotate-180" : ""
                        }`}
                        aria-hidden
                      />
                    </div>
                    <span className="mt-1 block text-[11px] text-gray-500 md:hidden">
                      {chaveAberta ? "Toque para recolher" : "Toque para ver chave completa"}
                    </span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 text-xs md:text-sm text-gray-600 dark:text-gray-300 md:text-right">
                  <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-900 px-3 py-1 font-semibold">
                    Leituras: {g.leitura ? 1 : 0}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-900 px-3 py-1 font-semibold">
                    Entregas: {g.entregas.length}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-2 md:gap-3 md:grid-cols-2">
                <div className="rounded-xl md:rounded-2xl bg-gray-50 dark:bg-gray-900 p-3 md:p-4">
                  <div className="text-[11px] md:text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Leitura
                  </div>
                  <div className="text-base md:text-lg font-bold mt-0.5">
                    {g.leitura ? formatDt(g.leitura.created_at) : "—"}
                  </div>
                </div>

                <div className="rounded-xl md:rounded-2xl bg-gray-50 dark:bg-gray-900 p-3 md:p-4">
                  <div className="text-[11px] md:text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Última entrega
                  </div>
                  <div className="text-base md:text-lg font-bold mt-0.5">
                    {g.lastEntrega ? formatDt(g.lastEntrega.created_at) : "—"}
                  </div>
                </div>
              </div>

              {g.lastEntrega ? (
                <div className="mt-4 rounded-xl md:rounded-2xl bg-[#009739]/10 dark:bg-[#009739]/15 p-3 md:p-4 space-y-3">
                  {g.lastEntrega.payload &&
                  (g.lastEntrega.payload.descricao != null ||
                    g.lastEntrega.payload.de != null ||
                    g.lastEntrega.payload.para != null) ? (
                    <div>
                      <div className="text-[11px] md:text-sm font-bold uppercase text-gray-600 dark:text-gray-400">
                        Última ação
                      </div>
                      <div className="text-sm md:text-lg font-bold mt-0.5 break-words">
                        {String(g.lastEntrega.payload?.descricao ?? "Item")} •{" "}
                        {String(g.lastEntrega.payload?.de ?? "—")} →{" "}
                        {String(g.lastEntrega.payload?.para ?? "—")}
                      </div>
                    </div>
                  ) : null}
                  <p className="hidden md:block text-sm text-gray-700 dark:text-gray-300">
                    Gere o PDF com os <strong>itens entregues</strong> (dados da
                    nota) cuja <strong>última retirada</strong> cai no dia{" "}
                    <strong>{diaPtBrReferencia(g.lastEntrega.created_at)}</strong>{" "}
                    (fuso America/São Paulo), para esta chave.
                  </p>
                  <p className="md:hidden text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                    PDF do dia{" "}
                    <strong>{diaPtBrReferencia(g.lastEntrega.created_at)}</strong>{" "}
                    (retiradas nesse dia, fuso SP).
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
                    className="w-full md:w-auto md:inline-flex items-center justify-center gap-2 rounded-xl bg-[#009739] px-5 py-3.5 md:py-3 font-bold text-white shadow-sm transition hover:bg-[#007a2e] disabled:opacity-60 active:scale-[0.99]"
                  >
                    <FileDown className="h-5 w-5 shrink-0" />
                    {pdfChaveLoading === g.chave
                      ? "Gerando PDF…"
                      : "PDF entregas do dia"}
                  </button>
                </div>
              ) : null}

              {fechamentos.length > 0 ? (
                <div className="mt-5 md:mt-6 space-y-4 md:space-y-6">
                  <div className="text-xs md:text-sm font-extrabold uppercase tracking-wide text-[#005c2e] dark:text-[#4ade80]">
                    Fechamentos (conferência)
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
                        className="rounded-xl md:rounded-2xl border-2 border-[#005c2e]/40 dark:border-[#4ade80]/30 bg-white dark:bg-gray-900/80 p-3 md:p-4 shadow-inner space-y-3"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <div className="text-[10px] md:text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                              Registrado em
                            </div>
                            <div className="text-base md:text-lg font-bold">
                              {formatDt(ev.created_at)}
                            </div>
                            <div className="text-xs md:text-sm text-gray-600 dark:text-gray-300 mt-1">
                              {itensPdf.length} item(ns) no snapshot
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              gerarPdfFechamento(g.chave, ev, capa, itensPdf)
                            }
                            disabled={pdfFechamentoId === ev.id}
                            className="w-full md:w-auto md:inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#005c2e] px-5 py-3.5 md:py-3 font-bold text-white shadow-sm transition hover:bg-[#004724] disabled:opacity-60 active:scale-[0.99]"
                          >
                            <FileDown className="h-5 w-5 shrink-0" />
                            {pdfFechamentoId === ev.id
                              ? "Gerando…"
                              : "PDF conferência"}
                          </button>
                        </div>
                        {rows.length > 0 ? (
                          <>
                            <div className="md:hidden space-y-2.5">
                              {rows.map((row, idx) => (
                                <SnapshotItemMobile
                                  key={String(row.id ?? idx)}
                                  row={row}
                                  idx={idx}
                                />
                              ))}
                            </div>
                            <div className="hidden md:block mt-2 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                              <table className="min-w-full text-sm">
                                <thead className="bg-gray-100 dark:bg-gray-800 text-left">
                                  <tr>
                                    <th className="px-3 py-2 font-bold">#</th>
                                    <th className="px-3 py-2 font-bold">
                                      Descrição
                                    </th>
                                    <th className="px-3 py-2 font-bold">Un.</th>
                                    <th className="px-3 py-2 font-bold">
                                      Total
                                    </th>
                                    <th className="px-3 py-2 font-bold">
                                      Entregue
                                    </th>
                                    <th className="px-3 py-2 font-bold">
                                      Saldo
                                    </th>
                                    <th className="px-3 py-2 font-bold">
                                      Status
                                    </th>
                                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                                      Últ. retirada
                                    </th>
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
                                      <td className="px-3 py-2">
                                        <span className="block whitespace-normal">
                                          {String(row.status ?? "")}
                                        </span>
                                        {Boolean(row.parcial_confirmada) ? (
                                          <span className="block text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                                            Parcial confirmada
                                          </span>
                                        ) : null}
                                      </td>
                                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                                        {typeof row.ultima_retirada_em ===
                                          "string" && row.ultima_retirada_em
                                          ? formatDt(row.ultima_retirada_em)
                                          : "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
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
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-6 md:p-8 text-center text-sm md:text-base text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60">
            Sem eventos ainda. Use <strong>Operação</strong> para ler a nota; ao{" "}
            <strong>fechar a entrega</strong>, o relatório aparece aqui.
          </div>
        ) : null}
      </div>
    </div>
  );
}
