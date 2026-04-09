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
  status: "PENDENTE" | "PARCIAL" | "ENTREGUE";
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function OperacaoPage() {
  const { user } = useAuth();
  const sb = getSupabaseClient();

  const [chave, setChave] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      try {
        // 1) tenta cache no Supabase via processarChaveNfe (retorna rápido se já existir)
        const res: any = await processarChaveNfe(chave44);
        const itensNota =
          (res?.itens_nota ??
            res?.itens_nota?.data ??
            res?.itens_nota) as Item[] | undefined;

        if (itensNota?.length) {
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
    atualizarItem(item.id, item.quantidade_total);
    await logEvento("ENTREGA", {
      item_id: item.id,
      descricao: item.descricao,
      de: item.quantidade_entregue,
      para: item.quantidade_total,
    });
  };

  const step = async (item: Item, delta: number) => {
    const next = clamp(
      item.quantidade_entregue + delta,
      0,
      item.quantidade_total,
    );
    atualizarItem(item.id, next);
    await logEvento("ENTREGA", {
      item_id: item.id,
      descricao: item.descricao,
      de: item.quantidade_entregue,
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

      <div className="space-y-6">
        {itens.map((item) => {
          const entregueTudo = item.status === "ENTREGUE";
          return (
            <div
              key={item.id}
              className={[
                "rounded-2xl p-6 shadow-md border-l-8",
                "bg-white dark:bg-gray-800",
                entregueTudo ? "border-[#009739]" : "border-[#FFDF00]",
              ].join(" ")}
            >
              <div className="mb-6">
                <h3 className="text-2xl font-bold mb-2">{item.descricao}</h3>
                <p className="text-lg opacity-75">
                  Total da Nota:{" "}
                  <strong>
                    {item.quantidade_total} {item.unidade}
                  </strong>
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 p-2 rounded-xl">
                  <button
                    type="button"
                    onClick={() => void step(item, -1)}
                    className="p-6 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded-lg active:scale-95"
                    aria-label="Diminuir"
                  >
                    <Minus className="w-10 h-10" />
                  </button>

                  <div className="text-center">
                    <div className="text-5xl font-bold">
                      {item.quantidade_entregue}
                    </div>
                    <div className="text-sm opacity-70">
                      entregue(s) / {item.quantidade_total}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void step(item, +1)}
                    className="p-6 bg-green-100 text-[#009739] dark:bg-green-900/30 dark:text-green-300 rounded-lg active:scale-95"
                    aria-label="Aumentar"
                  >
                    <Plus className="w-10 h-10" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void entregarTudo(item)}
                  className="w-full flex items-center justify-center gap-3 py-6 bg-[#009739] text-white rounded-xl text-2xl font-bold active:bg-[#007a2e] active:scale-95 transition-all shadow-lg"
                >
                  <CheckCircle className="w-8 h-8" />
                  Entregar Tudo ({item.quantidade_total})
                </button>
              </div>
            </div>
          );
        })}

        {!itens.length ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60">
            Nenhum item carregado ainda. Use a pistola, a câmera, ou digite a
            chave e toque em Buscar.
          </div>
        ) : null}
      </div>
    </div>
  );
}

