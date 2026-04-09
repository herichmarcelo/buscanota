"use client";

import { useEffect, useRef } from "react";

type Props = {
  onScan: (chave44: string) => void;
  enabled?: boolean;
};

export function ScannerListener({ onScan, enabled = true }: Props) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = "";
    let timeout: number | undefined;

    const reset = () => {
      buffer = "";
      if (timeout) window.clearTimeout(timeout);
      timeout = undefined;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Evita capturar quando usuário está digitando manualmente em um input/textarea.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (target as any)?.isContentEditable) {
        return;
      }

      if (e.key === "Enter") {
        if (/^\d{44}$/.test(buffer)) {
          onScanRef.current(buffer);
        }
        reset();
        return;
      }

      if (/^\d$/.test(e.key)) {
        buffer += e.key;

        if (timeout) window.clearTimeout(timeout);
        timeout = window.setTimeout(() => {
          // Se houver pausa, assume digitação humana e descarta.
          reset();
        }, 60);
      } else {
        // Qualquer outra tecla suja o buffer.
        reset();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      reset();
    };
  }, [enabled]);

  return null;
}

