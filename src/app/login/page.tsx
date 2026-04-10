"use client";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const sb = getSupabaseClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!sb) {
      setError(
        "Supabase não configurado. Preencha as variáveis NEXT_PUBLIC_SUPABASE_* em .env.local.",
      );
      return;
    }

    setLoading(true);
    try {
      const { error: err } = await sb.auth.signInWithPassword({
        email,
        password,
      });
      if (err) throw err;
      router.replace("/operacao");
    } catch (e: any) {
      setError(e?.message ?? "Falha no login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-white text-gray-900 dark:bg-[#07130c] dark:text-gray-50">
      {/* background */}
      <div aria-hidden className="absolute inset-0">
        <div className="absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full bg-[#009739]/25 blur-3xl" />
        <div className="absolute -bottom-44 -right-36 h-[520px] w-[520px] rounded-full bg-[#FFDF00]/25 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,151,57,0.10),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(255,223,0,0.10),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(74,222,128,0.10),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(253,224,71,0.12),transparent_55%)]" />
        <div className="absolute inset-0 opacity-[0.06] dark:opacity-[0.10] [background-image:linear-gradient(to_right,#000_1px,transparent_1px),linear-gradient(to_bottom,#000_1px,transparent_1px)] [background-size:28px_28px]" />
      </div>

      <div className="relative min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="rounded-3xl bg-white/90 dark:bg-gray-950/40 border border-gray-200/70 dark:border-emerald-400/15 shadow-xl shadow-black/5 dark:shadow-black/30 p-5 sm:p-6 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full bg-[#009739]/10 dark:bg-emerald-400/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#005c2e] dark:text-emerald-200">
                  Copagril
                  <span className="opacity-60">•</span>
                  Operação
                </div>
                <h1 className="mt-3 text-2xl font-black tracking-tight">
                  Acesso ao sistema
                </h1>
                <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                  Entre com suas credenciais para acessar Operação, Conferir e
                  Relatórios.
                </p>
              </div>
              <div className="shrink-0 rounded-2xl bg-gradient-to-br from-[#009739] to-[#005c2e] dark:from-emerald-400 dark:to-emerald-700 p-[1px]">
                <div className="h-11 w-11 rounded-2xl bg-white dark:bg-gray-950/60 grid place-items-center">
                  <div className="h-6 w-6 rounded-xl bg-[#009739] dark:bg-emerald-400" />
                </div>
              </div>
            </div>

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300"
                >
                  E-mail / Matrícula
                </label>
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500 dark:text-gray-300"
                    aria-hidden
                  />
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-12 rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 pl-11 pr-4 text-base font-semibold text-gray-900 dark:text-gray-50 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#009739] focus:outline-none focus:ring-4 focus:ring-[#009739]/15 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/15"
                    placeholder="ex.: operador@copagril.com.br"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300"
                >
                  Senha
                </label>
                <div className="relative">
                  <Lock
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500 dark:text-gray-300"
                    aria-hidden
                  />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-12 rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 pl-11 pr-12 text-base font-semibold text-gray-900 dark:text-gray-50 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#009739] focus:outline-none focus:ring-4 focus:ring-[#009739]/15 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/15"
                    placeholder="Digite sua senha"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-2xl grid place-items-center text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800/60 transition"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    disabled={loading}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/25 px-4 py-3 text-sm text-red-700 dark:text-red-200">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 rounded-2xl font-extrabold text-base text-white bg-[#009739] hover:bg-[#007a2e] active:scale-[0.99] transition disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-[#FFDF00]/40 dark:focus:ring-amber-300/30"
              >
                {loading ? "Entrando…" : "Entrar"}
              </button>

              <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                Se não conseguir entrar, verifique conexão e credenciais. Em caso
                de erro persistente, peça suporte para liberar seu acesso.
              </p>
            </form>
          </div>

          <div className="mt-5 text-center text-[11px] text-gray-500 dark:text-gray-400">
            © {new Date().getFullYear()} Copagril • Ambiente operacional
          </div>
        </div>
      </div>
    </div>
  );
}

