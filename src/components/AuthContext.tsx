"use client";

import { getSupabaseClient } from "@/lib/supabaseClient";
import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Role = "superadmin" | "estoquista";

export type Profile = {
  id: string;
  nome: string | null;
  role: Role;
};

type AuthState = {
  ready: boolean;
  user: User | null;
  profile: Profile | null;
  role: Role | null;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider />");
  return ctx;
}

export function AuthProvider({
  children,
  requireAuth = false,
}: {
  children: React.ReactNode;
  requireAuth?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sb = getSupabaseClient();

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      if (!sb) {
        if (mounted) setReady(true);
        return;
      }

      const { data } = await sb.auth.getSession();
      if (!mounted) return;

      setUser(data.session?.user ?? null);

      if (data.session?.user) {
        const { data: p } = await sb
          .from("profiles")
          .select("id,nome,role")
          .eq("id", data.session.user.id)
          .maybeSingle();
        if (!mounted) return;
        setProfile((p as Profile | null) ?? null);
      } else {
        setProfile(null);
      }

      setReady(true);
    }

    boot();

    if (!sb) return;
    const { data: sub } = sb.auth.onAuthStateChange(async (_evt, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        const { data: p } = await sb
          .from("profiles")
          .select("id,nome,role")
          .eq("id", session.user.id)
          .maybeSingle();
        setProfile((p as Profile | null) ?? null);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [sb]);

  useEffect(() => {
    if (!requireAuth) return;
    if (!ready) return;
    if (!sb) return;

    if (!user && pathname !== "/login") {
      router.replace("/login");
    }
  }, [pathname, ready, requireAuth, router, sb, user]);

  const signOut = async () => {
    if (!sb) return;
    await sb.auth.signOut();
    router.replace("/login");
  };

  const value = useMemo<AuthState>(
    () => ({
      ready,
      user,
      profile,
      role: profile?.role ?? null,
      signOut,
    }),
    [profile, ready, user],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

