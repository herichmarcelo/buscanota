"use client";

import { Camera, CheckCircle, Minus, Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { CameraModal } from "@/components/CameraModal";
import { ScannerListener } from "@/components/ScannerListener";
import { processarChaveNfe } from "@/lib/processarChaveNfe";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthContext";

type Item = {
  id: string;
  descricao: string;
  unidade: string;
  quantidade_total: number;
  quantidade_entregue: number;
  saldo_restante?: number;
  ultima_retirada_em?: string | null;
  status: "PENDENTE" | "PARCIAL" | "ENTREGUE";
};

type NotaHeader = {
  chave_acesso: string;
  data_emissao?: string | null;
  cliente_nome?: string | null;
  cliente_doc?: string | null;
  cliente_municipio_uf?: string | null;
  emitente_nome?: string | null;
  numero?: string | null;
  serie?: string | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pick(obj: any, path: string) {
  return path.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
}

function fmtDoc(doc?: string | null) {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return doc ?? null;
}

function fmtDt(iso?: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function extractHeaderFromNota(nota: any): NotaHeader {
  const payload = nota?.payload ?? null;
  const data0 = Array.isArray(payload?.data) ? payload.data[0] : payload?.data ?? null;

  const dest = pick(data0, "destinatario") ?? pick(data0, "nfe.destinatario") ?? pick(data0, "nfe_completa.destinatario");
  const emit = pick(data0, "emitente") ?? pick(data0, "nfe.emitente") ?? pick(data0, "nfe_completa.emitente");

  const clienteNome =
    dest?.nome ??
    dest?.nome_razao_social ??
    dest?.nome_razao_social_destinatario ??
    null;
  const clienteDoc = fmtDoc(dest?.cnpj ?? dest?.cpf ?? dest?.normalizado_cnpj ?? dest?.normalizado_cpf ?? null);
  const clienteUf = dest?.uf ?? null;
  const clienteMunicipio = dest?.municipio ?? dest?.normalizado_municipio ?? null;

  const emitNome = emit?.nome ?? emit?.nome_razao_social ?? emit?.nome_fantasia ?? null;

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

export default function OperacaoPage() {
  const { user } = useAuth();
  const sb = getSupabaseClient();

  const [chave, setChave] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notaHeader, setNotaHeader] = useState<NotaHeader | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const lastChaveRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const pendentes = useMemo(
    () => itens.filter((i) => i.status !== "ENTREGUE").length,
    [itens],
  );

  // evita timer vazando ao trocar de página
  // (sem useEffect pra não adicionar mais re-render; limpa em unload)
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

      try {
        // 1) tenta cache no Supabase via processarChaveNfe (retorna rápido se já existir)
        const res: any = await processarChaveNfe(chave44);
        const itensNota =
          (res?.itens_nota ??
            res?.itens_nota?.data ??
            res?.itens_nota) as Item[] | undefined;

        if (itensNota?.length) {
          setNotaHeader(extractHeaderFromNota(res));
          setItens(
            itensNota.map((x: any) => ({
              id: String(x.id ?? crypto.randomUUID()),
              descricao: String(x.descricao ?? ""),
              unidade: String(x.unidade ?? ""),
              quantidade_total: Number(x.quantidade_total ?? 0),
              quantidade_entregue: Number(x.quantidade_entregue ?? 0),
              status: (x.status ?? "PENDENTE") as Item["status"],
            })),
          );
          await logEvento("LEITURA");
          return;
        }

        // 2) se não veio cache, enfileirou job — mostra placeholder e começa polling
        setItens([]);
        await logEvento("LEITURA");

        // Garante que o job existe (evita ficar só em GET/poll sem ter enfileirado nada)
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
          // Plano Hobby da Vercel não permite cron por minuto.
          // Enquanto houver job pendente, a própria tela "cutuca" o worker com o token do Supabase.
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
          const r = await fetch(`/api/nfe-jobs?chave=${encodeURIComponent(chave)}`);
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
            setItens(
              items.map((x: any) => ({
                id: String(x.id ?? crypto.randomUUID()),
                descricao: String(x.descricao ?? ""),
                unidade: String(x.unidade ?? ""),
                quantidade_total: Number(x.quantidade_total ?? 0),
                quantidade_entregue: Number(x.quantidade_entregue ?? 0),
                status: (x.status ?? "PENDENTE") as Item["status"],
              })),
            );
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
        // no fluxo com polling, o loading é finalizado no poll quando OK/ERRO
        // aqui só desligamos se não entrou em polling
        if (!pollTimerRef.current) setLoading(false);
      }
    },
    [logEvento],
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

  const entregarTudo = async (item: Item) => {
    const before = item.quantidade_entregue;
    atualizarItem(item.id, item.quantidade_total);
    try {
      const { data } = await sb!.auth.getSession();
      const access = data.session?.access_token;
      if (access) {
        const r = await fetch("/api/itens-entrega", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${access}`,
          },
          body: JSON.stringify({
            item_id: item.id,
            quantidade_entregue: item.quantidade_total,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.item) {
          setItens((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    quantidade_entregue: Number(j.item.quantidade_entregue ?? it.quantidade_entregue),
                    status: (j.item.status ?? it.status) as Item["status"],
                    saldo_restante: Number(j.item.saldo_restante ?? 0),
                    ultima_retirada_em: j.item.ultima_retirada_em ?? null,
                  }
                : it,
            ),
          );
        } else if (!r.ok) {
          setError(j?.error ?? "Falha ao salvar entrega.");
        }
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

  const step = async (item: Item, delta: number) => {
    const before = item.quantidade_entregue;
    const next = clamp(before + delta, 0, item.quantidade_total);
    atualizarItem(item.id, next);

    try {
      const { data } = await sb!.auth.getSession();
      const access = data.session?.access_token;
      if (access) {
        const r = await fetch("/api/itens-entrega", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${access}`,
          },
          body: JSON.stringify({ item_id: item.id, quantidade_entregue: next }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.item) {
          setItens((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    quantidade_entregue: Number(j.item.quantidade_entregue ?? it.quantidade_entregue),
                    status: (j.item.status ?? it.status) as Item["status"],
                    saldo_restante: Number(j.item.saldo_restante ?? 0),
                    ultima_retirada_em: j.item.ultima_retirada_em ?? null,
                  }
                : it,
            ),
          );
        } else if (!r.ok) {
          setError(j?.error ?? "Falha ao salvar entrega.");
        }
      }
    } catch {
      setError("Falha de rede ao salvar entrega.");
    }

    await logEvento("ENTREGA", {
      item_id: item.id,
      descricao: item.descricao,
      de: before,
      para: next,
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <ScannerListener onScan={carregarNota} enabled={!cameraOpen && !loading} />

      <CameraModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={(text) => {
          const digits = (text.match(/\d/g) ?? []).join("");
          if (digits.length === 44) carregarNota(digits);
          else setError("Leitura da câmera não retornou uma chave de 44 dígitos.");
        }}
      />

      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border-t-4 border-[#009739]">
        <div className="space-y-1 mb-4">
          <h1 className="text-3xl font-bold">Operação</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {itens.length
              ? `${itens.length} item(ns) • ${pendentes} pendente(s)`
              : "Aguardando leitura de NFe"}
          </p>
        </div>

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
              onClick={() => carregarNota(chave)}
              disabled={loading}
              className={[
                "flex-1 sm:flex-none px-6 py-4 rounded-xl font-bold text-white transition-all",
                loading
                  ? "bg-gray-400 animate-pulse"
                  : "bg-[#009739] active:bg-[#007a2e] active:scale-95",
                "disabled:opacity-80",
              ].join(" ")}
            >
              {loading ? "⏳ Consultando SEFAZ..." : "Buscar Nota"}
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

      {/* Lista linha-a-linha (conferência) */}
      {itens.length ? (
        <div className="rounded-2xl bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h2 className="text-xl font-bold">Itens da nota (linha a linha)</h2>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Toque nos botões para dar baixa.
            </div>
          </div>

          <div className="hidden md:grid grid-cols-[64px_1fr_120px_120px_120px_220px] gap-3 px-6 py-3 text-sm font-bold text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900">
            <div>Linha</div>
            <div>Descrição</div>
            <div>Total</div>
            <div>Entregue</div>
            <div>Saldo</div>
            <div>Ações</div>
          </div>

          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {itens.map((item, idx) => {
              const saldo = Math.max(0, item.quantidade_total - item.quantidade_entregue);
              const entregueTudo = item.status === "ENTREGUE";
              return (
                <div
                  key={item.id}
                  className={[
                    "px-6 py-5 grid gap-4 items-center",
                    "md:grid-cols-[64px_1fr_120px_120px_120px_220px]",
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
                      Status:{" "}
                      <span className="font-bold">
                        {item.status}
                      </span>
                    </div>
                  </div>

                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {item.quantidade_total} {item.unidade}
                  </div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {item.quantidade_entregue} {item.unidade}
                  </div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {saldo} {item.unidade}
                  </div>

                  <div className="flex items-center gap-3 justify-start md:justify-end">
                    <button
                      type="button"
                      onClick={() => void step(item, -1)}
                      className="p-4 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded-xl active:scale-95"
                      aria-label="Diminuir"
                    >
                      <Minus className="w-7 h-7" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void step(item, +1)}
                      className="p-4 bg-green-100 text-[#009739] dark:bg-green-900/30 dark:text-green-300 rounded-xl active:scale-95"
                      aria-label="Aumentar"
                    >
                      <Plus className="w-7 h-7" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void entregarTudo(item)}
                      className="px-5 py-4 rounded-xl font-extrabold bg-[#009739] text-white active:bg-[#007a2e] active:scale-95 transition-all shadow-sm flex items-center gap-2"
                    >
                      <CheckCircle className="w-6 h-6" />
                      Entregar tudo
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {!itens.length ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60">
          Nenhum item carregado ainda. Use a pistola, a câmera, ou digite a
          chave e toque em Buscar.
        </div>
      ) : null}
    </div>
  );
}

