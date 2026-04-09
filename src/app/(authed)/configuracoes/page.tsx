"use client";

import { useAuth } from "@/components/AuthContext";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useEffect, useMemo, useState } from "react";

type AdminUser = {
  id: string;
  email: string | null;
  created_at: string;
};

export default function ConfiguracoesPage() {
  const { role } = useAuth();
  const sb = getSupabaseClient();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nome, setNome] = useState("");
  const [newRole, setNewRole] = useState<"superadmin" | "estoquista">(
    "estoquista",
  );

  const canSee = role === "superadmin";

  const token = useMemo(async () => {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  }, [sb]);

  const fetchUsers = async () => {
    setError(null);
    setLoading(true);
    try {
      if (!sb) throw new Error("Supabase não configurado.");
      const { data } = await sb.auth.getSession();
      const access = data.session?.access_token;
      if (!access) throw new Error("Sessão expirada.");

      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${access}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Falha ao listar usuários.");

      const mapped = (json.users ?? []).map((u: any) => ({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
      }));
      setUsers(mapped);
    } catch (e: any) {
      setError(e?.message ?? "Erro.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canSee) void fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSee]);

  const createUser = async () => {
    setError(null);
    setLoading(true);
    try {
      if (!sb) throw new Error("Supabase não configurado.");
      const { data } = await sb.auth.getSession();
      const access = data.session?.access_token;
      if (!access) throw new Error("Sessão expirada.");

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access}`,
        },
        body: JSON.stringify({
          email,
          password,
          nome: nome || null,
          role: newRole,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Falha ao criar usuário.");

      setEmail("");
      setPassword("");
      setNome("");
      setNewRole("estoquista");
      await fetchUsers();
    } catch (e: any) {
      setError(e?.message ?? "Erro.");
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (id: string) => {
    setError(null);
    setLoading(true);
    try {
      if (!sb) throw new Error("Supabase não configurado.");
      const { data } = await sb.auth.getSession();
      const access = data.session?.access_token;
      if (!access) throw new Error("Sessão expirada.");

      const res = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${access}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Falha ao deletar usuário.");
      await fetchUsers();
    } catch (e: any) {
      setError(e?.message ?? "Erro.");
    } finally {
      setLoading(false);
    }
  };

  if (!canSee) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm border-t-4 border-[#009739]">
          <h1 className="text-3xl font-bold">Configurações</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            Você não tem permissão para acessar esta tela.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm border-t-4 border-[#009739]">
        <h1 className="text-3xl font-bold">Configurações (Superadmin)</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-300">
          Crie usuários e gerencie acessos.
        </p>
      </div>

      <div className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm border-l-8 border-[#FFDF00]">
        <h2 className="text-2xl font-bold mb-4">Criar usuário</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome (opcional)"
            className="p-4 text-lg border-2 border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900"
          />
          <select
            value={newRole}
            onChange={(e) =>
              setNewRole(e.target.value as "superadmin" | "estoquista")
            }
            className="p-4 text-lg border-2 border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900"
          >
            <option value="estoquista">Estoquista</option>
            <option value="superadmin">Superadmin</option>
          </select>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="p-4 text-lg border-2 border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
            type="password"
            className="p-4 text-lg border-2 border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900"
          />
        </div>
        <button
          type="button"
          onClick={() => void createUser()}
          disabled={loading}
          className="mt-4 w-full sm:w-auto px-8 py-4 rounded-xl font-bold bg-[#009739] text-white disabled:opacity-60"
        >
          Criar
        </button>
        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>

      <div className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Usuários</h2>
          <button
            type="button"
            onClick={() => void fetchUsers()}
            disabled={loading}
            className="px-6 py-3 rounded-xl font-bold bg-gray-100 dark:bg-gray-900 disabled:opacity-60"
          >
            Atualizar
          </button>
        </div>

        <div className="mt-4 grid gap-4">
          {users.map((u) => (
            <div
              key={u.id}
              className="rounded-2xl border border-gray-200 dark:border-gray-700 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
              <div>
                <div className="text-lg font-bold">{u.email ?? "—"}</div>
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  ID: <span className="font-mono">{u.id}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void deleteUser(u.id)}
                disabled={loading}
                className="px-6 py-4 rounded-xl font-bold bg-red-600 text-white disabled:opacity-60"
              >
                Deletar
              </button>
            </div>
          ))}

          {!users.length ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-600 dark:text-gray-300">
              Nenhum usuário listado.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

