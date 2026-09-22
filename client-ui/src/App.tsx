import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { SettingsModal } from "./components/SettingsModal";
import { SearchModal } from "./components/SearchModal";
import { NewProjectModal } from "./components/NewProjectModal";
import { initTheme } from "./lib/theme";

// Títulos das sessões mock (para o cabeçalho do chat). Em produção vem da API.
const TITLES: Record<string, string> = {
  s_mkt: "Marketing — Urban Passageiro",
  s_start: "Primeiros passos",
  s_cfg: "Dúvidas de configuração",
  s_report: "Relatório de analytics",
  s_future: "O futuro da IA e seu impacto…",
};

// Painel do cliente — layout chat-first (estilo AIChat/Tailgrids):
// sidebar de conversas + área de chat central + modais (config, busca, projeto).
export default function App() {
  const params = new URLSearchParams(window.location.search);
  // Deep-link opcional de tema para testes (?theme=dark|light). Persiste via hook.
  const t = params.get("theme");
  if (t === "dark" || t === "light") {
    localStorage.setItem("hermes-theme", t);
    initTheme();
  }
  const [session, setSession] = useState<string | null>(params.get("s"));
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(params.get("settings") === "1");
  const [searchOpen, setSearchOpen] = useState(params.get("search") === "1");
  const [projectOpen, setProjectOpen] = useState(params.get("newproject") === "1");

  return (
    <div className="flex h-screen bg-background sm:p-2">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        activeSession={session}
        onSelectSession={setSession}
        onNewChat={() => setSession(null)}
        onOpenSearch={() => setSearchOpen(true)}
        onNewProject={() => setProjectOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="flex flex-1 flex-col p-2">
        <ChatArea sessionId={session} title={session ? TITLES[session] : undefined} />
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={setSession} />
      <NewProjectModal open={projectOpen} onClose={() => setProjectOpen(false)} onCreate={() => { /* mock: no-op */ }} />
    </div>
  );
}
