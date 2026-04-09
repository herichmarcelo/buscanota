"use client";

import Link from "next/link";
import { Camera, CheckCircle, Minus, Plus, Printer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraModal } from "@/components/CameraModal";
import { ScannerListener } from "@/components/ScannerListener";
import { processarChaveNfe } from "@/lib/processarChaveNfe";
import {
  getSupabaseClient,
  postJsonWithAuthRetry,
} from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthContext";
import { extractHeaderFromNota, type NotaHeader, fmtDt } from "@/lib/notaHeader";
import { imprimirTicketEntregas } from "@/lib/imprimirTicketEntrega";

type Item = {
  id: string;
  descricao: string;
  unidade: string;
  quantidade_total: number;
  quantidade_entregue: number;
  saldo_restante?: number;
  ultima_retirada_em?: string | null;
  status: "PENDENTE" | "PARCIAL" | "ENTREGUE";
  /** Após tocar em "Entrega parcial", o − fica travado. */
  parcial_confirmada?: boolean;
};

function mapRowToItem(x: any): Item {
  return {
    id: String(x.id ?? crypto.randomUUID()),
    descricao: String(x.descricao ?? ""),
    unidade: String(x.unidade ?? ""),
    quantidade_total: Number(x.quantidade_total ?? 0),
    quantidade_entregue: Number(x.quantidade_entregue ?? 0),
    status: (x.status ?? "PENDENTE") as Item["status"],
    parcial_confirmada: Boolean(x.parcial_confirmada),
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Linha com quantidade total já entregue — não entra na próxima rodada de baixa após reabrir nota. */
function linhaTotalmenteEntregue(item: Item): boolean {
  if (item.status === "ENTREGUE") return true;
  const t = item.quantidade_total;
  if (t > 0 && item.quantidade_entregue >= t) return true;
  return false;
}

export function OperacaoClient({
  search,
}: {
  search?: { from?: string; mode?: string; chave?: string };
}) {
  const { user, profile } = useAuth();
  const sb = getSupabaseClient();

  const from = search?.from ?? null;
  const mode = search?.mode ?? null; // 'baixa' para permitir entrega
  const chaveParam = (search?.chave ?? "").trim();
  const allowEntrega = mode === "baixa";

  const [chave, setChave] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notaHeader, setNotaHeader] = useState<NotaHeader | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [entregaFechada, setEntregaFechada] = useState(false);
  const [fecharEntregaLoading, setFecharEntregaLoading] = useState(false);
  const [reabrirEntregaLoading, setReabrirEntregaLoading] = useState(false);
  const lastChaveRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const entregaBloqueada = allowEntrega && entregaFechada;

  const pendentes = useMemo(
    () => itens.filter((i) => i.status !== "ENTREGUE").length,
    [itens],
  );

  const temAlgumaEntrega = useMemo(
    () => itens.some((i) => i.quantidade_entregue > 0),
    [itens],
  );

  /** Com entrega fechada, só faz sentido reabrir se ainda existir saldo em alguma linha. */
  const podeReabrirEntrega = useMemo(
    () =>
      allowEntrega &&
      entregaFechada &&
      itens.some(
        (i) =>
          i.quantidade_total > 0 &&
          i.quantidade_entregue < i.quantidade_total,
      ),
    [allowEntrega, entregaFechada, itens],
  );

  const temLinhasCongeladasEMoveis = useMemo(() => {
    const cong = itens.some((i) => linhaTotalmenteEntregue(i));
    const mov = itens.some((i) => !linhaTotalmenteEntregue(i));
    return cong && mov;
  }, [itens]);

  useEffect(() => {
    if (chaveParam && /^\d{44}$/.test(chaveParam)) {
      setChave(chaveParam);
      if (lastChaveRef.current !== chaveParam) {
        void carregarNota(chaveParam);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveParam]);

  if (typeof window !== "undefined") {
    window.onbeforeunload = () => {
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }

  const logEvento = useCallback(
    async (tipo: "LEITURA" | "ENTREGA", payload?: any) => {
      if (!sb || !user) return;
      if (!lastChaveRef.current) return;
      await sb.from("nfe_eventos").insert([
        {
          chave_acesso: lastChaveRef.current,
          user_id: user.id,
          tipo,
          payload: payload ?? null,
        },
      ]);
    },
    [sb, user],
  );

  const carregarNota = useCallback(
    async (chave44: string) => {
      if (loading && chave44 === lastChaveRef.current) return;
      setError(null);
      setLoading(true);
      setChave(chave44);
      lastChaveRef.current = chave44;
      setNotaHeader(null);
      setEntregaFechada(false);

      try {
        const res: any = await processarChaveNfe(chave44);
        const itensNota =
          (res?.itens_nota ??
            res?.itens_nota?.data ??
            res?.itens_nota) as Item[] | undefined;

        if (itensNota?.length) {
          setNotaHeader(extractHeaderFromNota(res));
          setEntregaFechada(Boolean(res?.entrega_fechada));
          setItens(itensNota.map(mapRowToItem));
          await logEvento("LEITURA");
          return;
        }

        setItens([]);
        await logEvento("LEITURA");

        const enqueueRes = await fetch("/api/nfe-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chave: chave44 }),
        });
        const enqueueJson = await enqueueRes.json().catch(() => ({}));
        if (!enqueueRes.ok) {
          throw new Error(
            enqueueJson?.error ?? "Falha ao enfileirar consulta da NFe.",
          );
        }

        const poll = async () => {
          if (!lastChaveRef.current) return;
          const chave = lastChaveRef.current;
          try {
            const { data } = await sb!.auth.getSession();
            const access = data.session?.access_token;
            if (access) {
              fetch("/api/nfe-worker", {
                method: "POST",
                headers: { Authorization: `Bearer ${access}` },
              }).catch(() => {});
            }
          } catch {}

          const r = await fetch(
            `/api/nfe-jobs?chave=${encodeURIComponent(chave)}`,
          );
          const j = await r.json().catch(() => ({}));
          if (!r.ok) {
            setError(j?.error ?? "Erro ao verificar status.");
            setLoading(false);
            return;
          }
          const status = j?.job?.status ?? null;
          if (status === "OK" && j?.nota?.itens_nota) {
            const items = j.nota.itens_nota as any[];
            setNotaHeader(extractHeaderFromNota(j.nota));
            setEntregaFechada(Boolean(j.nota?.entrega_fechada));
            setItens(items.map(mapRowToItem));
            setLoading(false);
            return;
          }
          if (status === "ERRO") {
            setError(j?.job?.erro ?? "Falha ao consultar NFe.");
            setLoading(false);
            return;
          }
          pollTimerRef.current = window.setTimeout(poll, 1200);
        };

        pollTimerRef.current = window.setTimeout(poll, 700);
      } catch (e: any) {
        setError(e?.message ?? "Erro ao processar a chave.");
        setItens([]);
      } finally {
        if (!pollTimerRef.current) setLoading(false);
      }
    },
    [logEvento, loading, sb],
  );

  const atualizarItem = (id: string, nextEntregue: number) => {
    setItens((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const entregue = clamp(nextEntregue, 0, item.quantidade_total);
        const status: Item["status"] =
          entregue === 0
            ? "PENDENTE"
            : entregue >= item.quantidade_total
              ? "ENTREGUE"
              : "PARCIAL";
        return { ...item, quantidade_entregue: entregue, status };
      }),
    );
  };

  const fecharEntrega = async () => {
    const chave44 = lastChaveRef.current;
    if (!chave44 || !/^\d{44}$/.test(chave44) || !sb) return;
    setFecharEntregaLoading(true);
    setError(null);
    try {
      const r = await postJsonWithAuthRetry(sb, "/api/fechar-entrega", {
        chave_acesso: chave44,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error ?? "Não foi possível fechar a entrega.");
        return;
      }
      if (j?.aviso_migracao) {
        setError(String(j.aviso_migracao));
      } else if (j?.aviso_relatorio) {
        setError(String(j.aviso_relatorio));
      }
      setEntregaFechada(true);
      if (j?.nota?.itens_nota?.length) {
        const items = j.nota.itens_nota as any[];
        setItens(items.map(mapRowToItem));
      }
      // Relatório de fechamento gravado em nfe_eventos pela API (snapshot dos itens).
    } catch {
      setError("Falha de rede ao fechar entrega.");
    } finally {
      setFecharEntregaLoading(false);
    }
  };

  const reabrirEntrega = async () => {
    const chave44 = lastChaveRef.current;
    if (!chave44 || !/^\d{44}$/.test(chave44) || !sb || !entregaFechada) return;
    setReabrirEntregaLoading(true);
    setError(null);
    try {
      const r = await postJsonWithAuthRetry(sb, "/api/reabrir-entrega", {
        chave_acesso: chave44,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error ?? "Não foi possível reabrir a entrega.");
        return;
      }
      if (j?.aviso_relatorio) {
        setError(String(j.aviso_relatorio));
      }
      setEntregaFechada(false);
      if (j?.nota?.itens_nota?.length) {
        const items = j.nota.itens_nota as any[];
        setItens(items.map(mapRowToItem));
      } else {
        void carregarNota(chave44);
      }
    } catch {
      setError("Falha de rede ao reabrir entrega.");
    } finally {
      setReabrirEntregaLoading(false);
    }
  };

  const entregarTudo = async (item: Item) => {
    if (entregaBloqueada || linhaTotalmenteEntregue(item)) return;
    const before = item.quantidade_entregue;
    atualizarItem(item.id, item.quantidade_total);
    try {
      const r = await postJsonWithAuthRetry(sb!, "/api/itens-entrega", {
        item_id: item.id,
        quantidade_entregue: item.quantidade_total,
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.item) {
        setItens((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  quantidade_entregue: Number(
                    j.item.quantidade_entregue ?? it.quantidade_entregue,
                  ),
                  status: (j.item.status ?? it.status) as Item["status"],
                  saldo_restante: Number(j.item.saldo_restante ?? 0),
                  ultima_retirada_em: j.item.ultima_retirada_em ?? null,
                  parcial_confirmada: Boolean(j.item.parcial_confirmada),
                }
              : it,
          ),
        );
      } else if (!r.ok) {
        setError(j?.error ?? "Falha ao salvar entrega.");
      }
    } catch {
      setError("Falha de rede ao salvar entrega.");
    }

    await logEvento("ENTREGA", {
      item_id: item.id,
      descricao: item.descricao,
      de: before,
      para: item.quantidade_total,
    });
  };

  const confirmarParcialItem = async (item: Item) => {
    if (
      entregaBloqueada ||
      linhaTotalmenteEntregue(item) ||
      item.status !== "PARCIAL" ||
      item.parcial_confirmada
    )
      return;
    try {
      const r = await postJsonWithAuthRetry(sb!, "/api/confirmar-parcial-item", {
        item_id: item.id,
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.item) {
        setItens((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  parcial_confirmada: Boolean(j.item.parcial_confirmada),
                }
              : it,
          ),
        );
        await logEvento("ENTREGA", {
          item_id: item.id,
          descricao: item.descricao,
          acao: "confirmar_entrega_parcial",
          quantidade_entregue: item.quantidade_entregue,
        });
      } else {
        setError(j?.error ?? "Não foi possível confirmar a entrega parcial.");
      }
    } catch {
      setError("Falha de rede ao confirmar entrega parcial.");
    }
  };

  const imprimirTicket = () => {
    if (!notaHeader || !itens.length) return;
    const atendente =
      profile?.nome?.trim() ||
      user?.email ||
      user?.id?.slice(0, 8) ||
      "—";
    const ok = imprimirTicketEntregas({
      notaHeader,
      itens: itens.map((i) => ({
        descricao: i.descricao,
        unidade: i.unidade,
        quantidade_total: i.quantidade_total,
        quantidade_entregue: i.quantidade_entregue,
      })),
      atendenteLabel: atendente,
    });
    if (!ok) {
      setError(
        "Não foi possível preparar a impressão do ticket. Atualize a página e tente de novo.",
      );
    }
  };

  const persistItemEntregue = async (item: Item, next: number) => {
    if (entregaBloqueada) return;
    const before = item.quantidade_entregue;
    const clamped = clamp(next, 0, item.quantidade_total);
    if (clamped === before) return;
    if (linhaTotalmenteEntregue(item) && clamped !== before) return;
    if (clamped < before) {
      if (
        item.parcial_confirmada ||
        (item.quantidade_total > 0 && before >= item.quantidade_total) ||
        item.status === "ENTREGUE"
      ) {
        return;
      }
    }

    atualizarItem(item.id, clamped);

    let salvou = false;
    try {
      const r = await postJsonWithAuthRetry(sb!, "/api/itens-entrega", {
        item_id: item.id,
        quantidade_entregue: clamped,
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.item) {
        salvou = true;
        setItens((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  quantidade_entregue: Number(
                    j.item.quantidade_entregue ?? it.quantidade_entregue,
                  ),
                  status: (j.item.status ?? it.status) as Item["status"],
                  saldo_restante: Number(j.item.saldo_restante ?? 0),
                  ultima_retirada_em: j.item.ultima_retirada_em ?? null,
                  parcial_confirmada: Boolean(j.item.parcial_confirmada),
                }
              : it,
          ),
        );
      } else {
        atualizarItem(item.id, before);
        setError(j?.error ?? "Falha ao salvar entrega.");
      }
    } catch {
      atualizarItem(item.id, before);
      setError("Falha de rede ao salvar entrega.");
    }

    if (salvou) {
      await logEvento("ENTREGA", {
        item_id: item.id,
        descricao: item.descricao,
        de: before,
        para: clamped,
      });
    }
  };

  const step = async (item: Item, delta: number) => {
    const before = item.quantidade_entregue;
    const next = clamp(before + delta, 0, item.quantidade_total);
    await persistItemEntregue(item, next);
  };

  const entregarQuantidadeDoSaldo = async (item: Item, qtd: number) => {
    const saldoMax = Math.floor(
      Math.max(0, item.quantidade_total - item.quantidade_entregue),
    );
    const n = Math.floor(Number(qtd));
    if (!Number.isFinite(n) || n < 1 || n > saldoMax) return;
    await persistItemEntregue(item, item.quantidade_entregue + n);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <ScannerListener onScan={carregarNota} enabled={!cameraOpen && !loading} />

      <CameraModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={(text) => {
          const digits = (text.match(/\d/g) ?? []).join("");
          if (digits.length === 44) void carregarNota(digits);
          else setError("Leitura da câmera não retornou uma chave de 44 dígitos.");
        }}
      />

      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border-t-4 border-[#009739]">
        <div className="space-y-1 mb-4">
          <h1 className="text-3xl font-bold">Operação</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {itens.length
              ? `${itens.length} item(ns) • ${pendentes} pendente(s)${
                  entregaBloqueada ? " • Entrega fechada" : ""
                }`
              : "Aguardando leitura de NFe"}
          </p>
        </div>

        {from === "conferir" ? (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              href="/conferir"
              className="inline-flex items-center rounded-xl px-4 py-2 font-bold bg-gray-100 dark:bg-gray-900"
            >
              ← Voltar para Conferir nota
            </Link>
            {allowEntrega && itens.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {!entregaFechada ? (
                  <button
                    type="button"
                    onClick={() => void fecharEntrega()}
                    disabled={fecharEntregaLoading}
                    className={[
                      "inline-flex items-center justify-center rounded-xl px-5 py-2 font-extrabold text-white transition",
                      fecharEntregaLoading
                        ? "bg-gray-500"
                        : "bg-[#005c2e] hover:bg-[#004724] active:scale-[0.98]",
                    ].join(" ")}
                  >
                    {fecharEntregaLoading ? "Fechando…" : "Fechar entrega"}
                  </button>
                ) : podeReabrirEntrega ? (
                  <button
                    type="button"
                    onClick={() => void reabrirEntrega()}
                    disabled={reabrirEntregaLoading}
                    className={[
                      "inline-flex items-center justify-center rounded-xl px-5 py-2 font-extrabold text-white transition",
                      reabrirEntregaLoading
                        ? "bg-gray-500"
                        : "bg-amber-600 hover:bg-amber-700 active:scale-[0.98] dark:bg-amber-700 dark:hover:bg-amber-600",
                    ].join(" ")}
                  >
                    {reabrirEntregaLoading ? "Reabrindo…" : "Reabrir entrega"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={imprimirTicket}
                  disabled={!temAlgumaEntrega || !notaHeader}
                  title={
                    temAlgumaEntrega
                      ? "Imprimir comprovante com itens já entregues"
                      : "Registre ao menos uma entrega para imprimir"
                  }
                  className={[
                    "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2 font-extrabold transition",
                    temAlgumaEntrega && notaHeader
                      ? "border-2 border-[#009739] bg-white text-[#009739] hover:bg-[#009739]/10 dark:bg-gray-900 dark:hover:bg-[#009739]/20"
                      : "cursor-not-allowed border-2 border-gray-300 text-gray-400 dark:border-gray-600",
                  ].join(" ")}
                >
                  <Printer className="h-5 w-5 shrink-0" />
                  Imprimir ticket
                </button>
              </div>
            ) : null}
            {allowEntrega && entregaFechada ? (
              <div className="text-sm space-y-1 max-w-2xl">
                <p className="font-semibold text-[#009739] dark:text-green-400">
                  Entrega fechada — registro congelado até reabrir.
                </p>
                {podeReabrirEntrega ? (
                  <p className="text-gray-600 dark:text-gray-300">
                    Use <strong>Reabrir entrega</strong> para continuar a baixa
                    só nas linhas com saldo. Linhas já totalmente entregues
                    permanecem travadas.
                  </p>
                ) : (
                  <p className="text-gray-600 dark:text-gray-300">
                    Todas as linhas estão totalmente entregues; não há saldo para
                    nova baixa nesta nota.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mb-4 rounded-xl bg-gray-50 dark:bg-gray-900 p-3 text-sm text-gray-700 dark:text-gray-200">
            Nesta tela você <strong>lê e salva</strong> a nota. Para dar baixa
            depois, use <strong>Conferir nota</strong>.
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            inputMode="numeric"
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            placeholder="Aguardando leitura… (44 dígitos)"
            className="flex-1 p-4 text-xl border-2 border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:border-[#009739] focus:outline-none"
          />

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void carregarNota(chave)}
              disabled={loading}
              className={[
                "flex-1 sm:flex-none px-6 py-4 rounded-xl font-bold text-white transition-all",
                loading
                  ? "bg-gray-400 animate-pulse"
                  : "bg-[#009739] active:bg-[#007a2e] active:scale-95",
                "disabled:opacity-80",
              ].join(" ")}
            >
              {loading ? "⏳ Consultando NFe..." : "Buscar Nota"}
            </button>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="flex-1 sm:flex-none px-6 py-4 rounded-xl font-bold bg-[#FFDF00] text-gray-900 active:bg-yellow-400 transition shadow-sm flex items-center justify-center gap-2"
            >
              <Camera className="w-7 h-7" />
              Câmera
            </button>
          </div>
        </div>

        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 text-center">
          Dica: com a pistola, você pode bipar a qualquer momento — o sistema
          está “escutando”.
        </p>

        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400 text-center">
            {error}
          </p>
        ) : null}
      </div>

      {notaHeader ? (
        <div className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm border-l-8 border-[#009739]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Cliente
              </div>
              <div className="text-2xl font-extrabold">
                {notaHeader.cliente_nome ?? "—"}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {notaHeader.cliente_doc ?? "—"}
                {notaHeader.cliente_municipio_uf
                  ? ` • ${notaHeader.cliente_municipio_uf}`
                  : ""}
              </div>
            </div>

            <div className="space-y-1 text-sm text-gray-700 dark:text-gray-200">
              <div>
                <span className="opacity-70">NFe:</span>{" "}
                <strong>
                  {notaHeader.numero ?? "—"}
                  {notaHeader.serie ? ` / Série ${notaHeader.serie}` : ""}
                </strong>
              </div>
              <div>
                <span className="opacity-70">Emissão:</span>{" "}
                <strong>{fmtDt(notaHeader.data_emissao) ?? "—"}</strong>
              </div>
              <div className="break-all">
                <span className="opacity-70">Chave:</span>{" "}
                <span className="font-mono">{notaHeader.chave_acesso}</span>
              </div>
              {notaHeader.emitente_nome ? (
                <div>
                  <span className="opacity-70">Emitente:</span>{" "}
                  <strong>{notaHeader.emitente_nome}</strong>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {itens.length ? (
        <div className="rounded-2xl bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold">Itens da nota (linha a linha)</h2>
            <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
              {allowEntrega ? (
                <>
                  <p>Toque nos botões para dar baixa.</p>
                  {temLinhasCongeladasEMoveis && !entregaBloqueada ? (
                    <p className="text-amber-800 dark:text-amber-200 font-medium">
                      Fundo verde: linha totalmente entregue (não altera). Demais:
                      use +/− ou o campo de saldo.
                    </p>
                  ) : null}
                </>
              ) : (
                <p>Baixa disponível em Conferir nota.</p>
              )}
            </div>
          </div>

          <div
            className={`hidden md:grid ${
              allowEntrega
                ? "grid-cols-[4rem_minmax(0,1fr)_5.5rem_5.5rem_minmax(11.5rem,13rem)_minmax(18rem,1fr)]"
                : "grid-cols-[64px_1fr_120px_120px_120px]"
            } gap-3 px-6 py-3 text-sm font-bold text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900`}
          >
            <div>Linha</div>
            <div>Descrição</div>
            <div>Total</div>
            <div>Entregue</div>
            <div>Saldo</div>
            {allowEntrega ? <div>Ações</div> : null}
          </div>

          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {itens.map((item, idx) => {
              const saldo = Math.max(
                0,
                item.quantidade_total - item.quantidade_entregue,
              );
              const saldoInt = Math.floor(saldo);
              const entregueTudo = linhaTotalmenteEntregue(item);
              const bloqueiaMenos =
                entregaBloqueada ||
                linhaTotalmenteEntregue(item) ||
                item.parcial_confirmada;
              const acoesEmDuasLinhas =
                item.status === "PARCIAL" && Boolean(item.parcial_confirmada);
              return (
                <div
                  key={item.id}
                  className={[
                    "px-6 py-5 grid gap-4 items-center",
                    allowEntrega
                      ? "md:grid-cols-[4rem_minmax(0,1fr)_5.5rem_5.5rem_minmax(11.5rem,13rem)_minmax(18rem,1fr)]"
                      : "md:grid-cols-[64px_1fr_120px_120px_120px]",
                    "grid-cols-1",
                    entregueTudo ? "bg-[#009739]/5 dark:bg-[#009739]/10" : "",
                  ].join(" ")}
                >
                  <div className="text-sm font-mono text-gray-500 dark:text-gray-400">
                    {String(idx + 1).padStart(2, "0")}
                  </div>

                  <div className="min-w-0">
                    <div className="text-lg font-extrabold break-words whitespace-normal leading-snug">
                      {item.descricao}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      Status: <span className="font-bold">{item.status}</span>
                    </div>
                  </div>

                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {item.quantidade_total} {item.unidade}
                  </div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {item.quantidade_entregue} {item.unidade}
                  </div>
                  <div className="min-w-0">
                    {allowEntrega &&
                    !entregaBloqueada &&
                    saldoInt > 0 &&
                    !linhaTotalmenteEntregue(item) ? (
                      <div
                        className={[
                          "rounded-2xl border-2 border-[#009739]/35 dark:border-[#4ade80]/40",
                          "bg-white dark:bg-gray-900 shadow-sm",
                          "p-3 w-full max-md:max-w-[11.5rem] max-md:mx-auto md:max-w-full min-w-0",
                          "max-md:aspect-square max-md:flex max-md:flex-col max-md:justify-between max-md:gap-2",
                          "touch-manipulation",
                        ].join(" ")}
                      >
                        <div className="text-center max-md:pt-0.5">
                          <div className="text-[10px] font-extrabold uppercase tracking-wide text-[#005c2e] dark:text-[#4ade80]">
                            Saldo
                          </div>
                          <div className="text-xl md:text-lg font-black tabular-nums text-gray-900 dark:text-gray-100 leading-tight">
                            {saldo} {item.unidade}
                          </div>
                        </div>
                        {saldoInt <= 200 ? (
                          <select
                            className="w-full min-h-[48px] md:min-h-[40px] rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-base md:text-sm font-bold text-gray-900 dark:text-gray-100"
                            aria-label={`Quantidade a retirar do saldo: de 1 a ${saldoInt} ${item.unidade}`}
                            defaultValue=""
                            onChange={(e) => {
                              const v = e.target.value;
                              const el = e.target;
                              el.value = "";
                              if (!v) return;
                              void entregarQuantidadeDoSaldo(item, Number(v));
                            }}
                          >
                            <option value="" disabled>
                              Toque: qtd a sair
                            </option>
                            {Array.from({ length: saldoInt }, (_, i) => (
                              <option key={i + 1} value={String(i + 1)}>
                                Retirar {i + 1} {item.unidade}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={saldoInt}
                              step={1}
                              id={`saldo-qty-${item.id}`}
                              placeholder={`1–${saldoInt}`}
                              aria-label={`Quantidade a retirar do saldo (1 a ${saldoInt})`}
                              className="w-full min-h-[48px] md:min-h-[40px] rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-3 text-center text-base md:text-sm font-bold text-gray-900 dark:text-gray-100 placeholder:font-normal"
                              onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                const el = e.currentTarget;
                                void entregarQuantidadeDoSaldo(
                                  item,
                                  Number(el.value),
                                );
                                el.value = "";
                              }}
                            />
                            <button
                              type="button"
                              className="min-h-[44px] md:min-h-[36px] rounded-xl bg-[#009739] text-white text-sm font-extrabold active:scale-[0.98]"
                              onClick={() => {
                                const el = document.getElementById(
                                  `saldo-qty-${item.id}`,
                                ) as HTMLInputElement | null;
                                if (!el) return;
                                void entregarQuantidadeDoSaldo(
                                  item,
                                  Number(el.value),
                                );
                                el.value = "";
                              }}
                            >
                              Confirmar saída
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                        {saldo} {item.unidade}
                      </div>
                    )}
                  </div>

                  {allowEntrega ? (
                    <div
                      className={[
                        "flex min-w-0 w-full gap-2",
                        acoesEmDuasLinhas
                          ? "flex-col items-stretch"
                          : "flex-row flex-wrap items-center justify-start md:justify-end",
                      ].join(" ")}
                    >
                      <div
                        className={[
                          "flex items-center gap-2 shrink-0",
                          acoesEmDuasLinhas
                            ? "justify-end w-full"
                            : "",
                        ].join(" ")}
                      >
                      <button
                        type="button"
                        onClick={() => void step(item, -1)}
                        disabled={bloqueiaMenos}
                        title={
                          bloqueiaMenos && !entregaBloqueada
                            ? linhaTotalmenteEntregue(item)
                              ? "Linha totalmente entregue: não pode alterar."
                              : item.parcial_confirmada
                                ? "Toque em Entrega parcial confirmou esta quantidade; não é possível reduzir."
                                : undefined
                            : undefined
                        }
                        className={[
                          "p-2 rounded-lg active:scale-95",
                          bloqueiaMenos
                            ? "bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800 dark:text-gray-600"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                        ].join(" ")}
                        aria-label="Diminuir"
                      >
                        <Minus className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void step(item, +1)}
                        disabled={
                          entregaBloqueada || linhaTotalmenteEntregue(item)
                        }
                        title={
                          linhaTotalmenteEntregue(item) && !entregaBloqueada
                            ? "Linha totalmente entregue."
                            : undefined
                        }
                        className={[
                          "p-2 rounded-lg active:scale-95",
                          entregaBloqueada || linhaTotalmenteEntregue(item)
                            ? "bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800 dark:text-gray-600"
                            : "bg-green-100 text-[#009739] dark:bg-green-900/30 dark:text-green-300",
                        ].join(" ")}
                        aria-label="Aumentar"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (entregaBloqueada) return;
                          if (item.status === "PENDENTE")
                            void entregarTudo(item);
                          else if (
                            item.status === "PARCIAL" &&
                            !item.parcial_confirmada
                          )
                            void confirmarParcialItem(item);
                        }}
                        disabled={
                          entregaBloqueada ||
                          linhaTotalmenteEntregue(item) ||
                          item.status === "ENTREGUE" ||
                          (item.status === "PARCIAL" &&
                            Boolean(item.parcial_confirmada))
                        }
                        className={[
                          "rounded-xl font-extrabold transition-all shadow-sm flex items-center justify-center gap-2 min-w-0",
                          acoesEmDuasLinhas
                            ? "w-full px-4 py-3 text-sm leading-snug"
                            : "px-5 py-4",
                          entregaBloqueada
                            ? "bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                            : item.status === "PENDENTE"
                              ? "bg-[#009739] text-white hover:bg-[#007a2e] active:bg-[#006b28] active:scale-95"
                              : item.status === "PARCIAL" &&
                                  !item.parcial_confirmada
                                ? "bg-amber-400 text-gray-900 hover:bg-amber-500 active:bg-amber-600 active:scale-95 dark:bg-amber-600 dark:text-white dark:hover:bg-amber-500"
                                : "bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400",
                        ].join(" ")}
                      >
                        <CheckCircle className="w-6 h-6 shrink-0" />
                        {item.status === "PENDENTE"
                          ? "Entregar tudo"
                          : item.status === "PARCIAL"
                            ? item.parcial_confirmada
                              ? "Parcial confirmada"
                              : "Entrega parcial"
                            : "Entregue"}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {!itens.length ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60">
          Nenhum item carregado ainda. Use a pistola, a câmera, ou digite a chave
          e toque em Buscar.
        </div>
      ) : null}
    </div>
  );
}

