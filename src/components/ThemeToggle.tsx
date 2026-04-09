"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

function setHtmlDarkClass(isDark: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", isDark);
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("copagril.theme");
    const initial = saved === "dark";
    setIsDark(initial);
    setHtmlDarkClass(initial);
  }, []);

  const toggle = () => {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem("copagril.theme", next ? "dark" : "light");
      setHtmlDarkClass(next);
      return next;
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="p-4 rounded-full bg-gray-200 dark:bg-gray-700 active:scale-95 transition-transform"
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
    >
      {isDark ? (
        <Sun className="w-8 h-8 text-[#FFDF00]" />
      ) : (
        <Moon className="w-8 h-8 text-gray-700 dark:text-gray-200" />
      )}
    </button>
  );
}

