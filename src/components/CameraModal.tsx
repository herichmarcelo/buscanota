"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (text: string) => void;
};

export function CameraModal({ open, onClose, onDetected }: Props) {
  const readerId = useMemo(
    () => `qr-reader-${Math.random().toString(36).slice(2)}`,
    [],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let stopped = false;
    let html5: any = null;

    async function start() {
      setError(null);
      try {
        const mod = await import("html5-qrcode");
        const Html5Qrcode = mod.Html5Qrcode;
        html5 = new Html5Qrcode(readerId);

        await html5.start(
          { facingMode: "environment" },
          {
            fps: 12,
            qrbox: { width: 280, height: 280 },
          },
          (decodedText: string) => {
            if (stopped) return;
            onDetected(decodedText);
            onClose();
          },
          () => {},
        );
      } catch (e: any) {
        setError(
          e?.message ??
            "Não foi possível iniciar a câmera. Verifique permissão do navegador.",
        );
      }
    }

    start();

    return () => {
      stopped = true;
      if (html5) {
        html5
          .stop()
          .catch(() => {})
          .finally(() => {
            html5?.clear?.();
          });
      }
    };
  }, [open, onClose, onDetected, readerId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-bold">Usar câmera</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Fechar"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="rounded-xl overflow-hidden bg-black">
            <div id={readerId} className="w-full aspect-square" />
          </div>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Aponte para o código de barras/QR da NFe. Assim que detectar, o
              modal fecha automaticamente.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

