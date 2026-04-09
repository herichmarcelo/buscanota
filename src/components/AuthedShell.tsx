"use client";

import { Sidebar } from "@/components/Sidebar";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

export function AuthedShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // Fecha menu ao mudar breakpoint/refresh etc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* Mobile top bar */}
      <div className="sm:hidden sticky top-0 z-40 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="p-3 rounded-xl bg-gray-100 dark:bg-gray-800 active:scale-[0.99]"
            aria-label="Abrir menu"
          >
            <Menu className="w-7 h-7" />
          </button>
          <div className="text-lg font-extrabold tracking-tight">
            Copagril Operação
          </div>
          <div className="w-[52px]" />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row">
        {/* Desktop sidebar */}
        <div className="hidden sm:block">
          <Sidebar />
        </div>

        {/* Mobile drawer sidebar */}
        {open ? (
          <div className="sm:hidden fixed inset-0 z-50">
            <button
              type="button"
              className="absolute inset-0 bg-black/50"
              aria-label="Fechar menu"
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-0 bottom-0 w-[86vw] max-w-[360px] shadow-2xl">
              <div className="relative h-full">
                <div className="absolute right-3 top-3 z-10">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="p-3 rounded-xl bg-white/90 dark:bg-gray-900/90 backdrop-blur border border-gray-200 dark:border-gray-800"
                    aria-label="Fechar"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <Sidebar onNavigate={() => setOpen(false)} />
              </div>
            </div>
          </div>
        ) : null}

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

