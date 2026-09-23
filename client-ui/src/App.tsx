import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { SettingsModal } from "./components/SettingsModal";
import { SearchModal } from "./components/SearchModal";
import { api, type AuthMe, type SessionRow } from "./lib/api";
import { gateway } from "./lib/gateway";
import { initTheme } from "./lib/theme";

// Painel do cliente — sidebar de conversas (GET /api/sessions) + chat (WS) +
// modais. O id na URL (?s=) é o STORED id (o mesmo da lista REST).
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const t = params.get("theme");
  if (t === "dark" || t === "light") { localStorage.setItem("hermes-theme", t); initTheme(); }

  const [session, setSession] = useState<string | null>(params.get("s"));
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [account, setAccount] = useState<AuthMe | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(params.get("settings") === "1");
  const [searchOpen, setSearchOpen] = useState(params.get("search") === "1");

  const refreshSessions = useCallback(() => {
    setLoadingSessions(true);
    api.listSessions().then((r) => setSessions(Array.isArray(r?.sessions) ? r.sessions : []))
      .catch(() => setSessions([])).finally(() => setLoadingSessions(false));
  }, []);

  useEffect(() => {
    refreshSessions();
    // /api/auth/me só existe atrás do gate; em dev (loopback) devolve 404 -> conta nula.
    api.me().then(setAccount).catch(() => setAccount(null));
    gateway.connect().catch(() => { /* ChatArea mostra o estado */ });
    // Outras abas/canais criam sessões: o gateway avisa por sessions.changed.
    const off = gateway.onEvent((ev) => { if (ev.type === "sessions.changed") refreshSessions(); });
    return off;
  }, [refreshSessions]);

  // Mantém ?s= na URL para recarregar na mesma conversa.
  useEffect(() => {
    const u = new URL(window.location.href);
    if (session) u.searchParams.set("s", session); else u.searchParams.delete("s");
    window.history.replaceState({}, "", u.toString());
  }, [session]);

  function onSessionCreated(storedId: string) {
    setSession(storedId);
    // A linha só aparece no SQLite depois do primeiro prompt; recarrega em seguida.
    setTimeout(refreshSessions, 1500);
  }
  function onTitle(storedId: string, title: string) {
    setSessions((cur) => cur.some((s) => s.id === storedId)
      ? cur.map((s) => (s.id === storedId ? { ...s, title } : s))
      : [{ id: storedId, title, last_active: Date.now() / 1000 }, ...cur]);
  }
  function onDeleted(storedId: string) {
    setSessions((cur) => cur.filter((s) => s.id !== storedId));
    if (session === storedId) setSession(null);
  }

  return (
    <div className="flex h-screen bg-background sm:p-2">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        activeSession={session}
        sessions={sessions}
        loadingSessions={loadingSessions}
        onRefresh={refreshSessions}
        onSelectSession={setSession}
        onNewChat={() => setSession(null)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        account={account}
      />
      <main className="flex flex-1 flex-col p-2">
        <ChatArea sessionId={session} onSessionCreated={onSessionCreated} onTitle={onTitle} onDeleted={onDeleted} />
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} account={account} />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={setSession} recent={sessions} />
    </div>
  );
}
