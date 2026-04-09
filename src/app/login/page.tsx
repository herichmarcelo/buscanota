"use client";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const sb = getSupabaseClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex w-3/5 relative overflow-hidden bg-[#009739]">
        <div
          className="absolute inset-0 bg-cover bg-center mix-blend-overlay opacity-40"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1600&q=80')",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#009739]/80 via-[#009739]/40 to-transparent" />

        <div className="absolute bottom-10 left-10 right-10 text-white z-10">
          <h1 className="text-5xl font-bold mb-4 tracking-tight">
            Copagril Operação
          </h1>
          <p className="text-xl opacity-90 max-w-xl">
            Gestão inteligente de entregas fracionadas (NFe) com foco no galpão.
          </p>
        </div>
      </div>

      <div className="w-full lg:w-2/5 flex items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-md space-y-8">
          <div>
            <h2 className="text-3xl font-extrabold text-gray-900">
              Acesso ao Sistema
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Digite suas credenciais de operador.
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={onSubmit}>
            <div className="rounded-md shadow-sm -space-y-px">
              <div>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none rounded-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-[#009739] focus:border-[#009739] focus:z-10 sm:text-sm"
                  placeholder="E-mail ou Matrícula"
                />
              </div>
              <div>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none rounded-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-[#009739] focus:border-[#009739] focus:z-10 sm:text-sm"
                  placeholder="Senha"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-[#009739] hover:bg-[#007a2e] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#FFDF00] transition-all duration-200 disabled:opacity-60"
              >
                {loading ? "Entrando..." : "Entrar no Sistema"}
              </button>
              {error ? (
                <p className="mt-3 text-sm text-red-600">{error}</p>
              ) : null}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

