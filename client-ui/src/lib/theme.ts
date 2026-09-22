import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
const KEY = "hermes-theme";

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function applyTheme(mode: ThemeMode) {
  const el = document.documentElement;
  el.classList.toggle("dark", resolve(mode) === "dark");
}

// Estado de tema compartilhado (sistema/claro/escuro), persistido em localStorage
// e reativo à preferência do SO quando em "sistema". Só troca cores — layout intacto.
export function useTheme(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem(KEY) as ThemeMode) || "system",
  );

  useEffect(() => {
    applyTheme(mode);
    localStorage.setItem(KEY, mode);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  return [mode, setMode];
}

// Aplica o tema salvo o quanto antes (chamado em main.tsx, evita flash claro).
export function initTheme() {
  applyTheme((localStorage.getItem(KEY) as ThemeMode) || "system");
}
