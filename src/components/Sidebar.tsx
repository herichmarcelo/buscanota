"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  LogOut,
  PackageSearch,
  Settings,
  Truck,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/components/AuthContext";

function NavItem({
  href,
  label,
  icon,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={[
        "flex items-center gap-3 rounded-xl px-4 py-4 text-lg font-semibold transition",
        active
          ? "bg-[#009739]/10 text-[#009739] dark:bg-[#009739]/20"
          : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800",
      ].join(" ")}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { profile, role, signOut } = useAuth();

  return (
    <aside className="w-full sm:w-[320px] lg:w-[340px] shrink-0 bg-white dark:bg-gray-900 border-b sm:border-b-0 sm:border-r border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-50">
      <div className="p-5 flex items-center justify-between border-b border-gray-200 dark:border-gray-800">
        <div>
          <div className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
            Copagril Operação
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {profile?.nome ?? "Operador"} • {role ?? "—"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onNavigate ? (
            <button
              type="button"
              onClick={onNavigate}
              className="sm:hidden p-3 rounded-xl bg-gray-100 dark:bg-gray-800 active:scale-[0.99]"
              aria-label="Fechar menu"
            >
              <X className="w-6 h-6 text-gray-900 dark:text-gray-100" />
            </button>
          ) : null}
          <ThemeToggle />
        </div>
      </div>

      <nav className="p-4 space-y-2">
        <NavItem
          href="/operacao"
          label="Operação"
          icon={<Truck className="w-6 h-6" />}
          onNavigate={onNavigate}
        />
        <NavItem
          href="/conferir"
          label="Conferir nota"
          icon={<PackageSearch className="w-6 h-6" />}
          onNavigate={onNavigate}
        />
        <NavItem
          href="/relatorios"
          label="Relatórios"
          icon={<ClipboardList className="w-6 h-6" />}
          onNavigate={onNavigate}
        />

        {role === "superadmin" ? (
          <NavItem
            href="/configuracoes"
            label="Configurações"
            icon={<Settings className="w-6 h-6" />}
            onNavigate={onNavigate}
          />
        ) : null}
      </nav>

      <div className="p-4 border-t border-gray-200 dark:border-gray-800">
        <button
          type="button"
          onClick={signOut}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-4 text-lg font-bold bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 active:scale-[0.99]"
        >
          <LogOut className="w-6 h-6" />
          Logout
        </button>
      </div>
    </aside>
  );
}

