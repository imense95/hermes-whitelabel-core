import { useEffect, useState } from "react";
import { api, type Account, type Project, type SessionSummary } from "../lib/api";

// Sidebar do painel do cliente — estilo AIChat/Tailgrids: logo, New Chat, Search,
// Projects com contador, conversas agrupadas por data e o cartão de conta embaixo
// (abre as configurações).
export function Sidebar({
  activeSession,
  onSelectSession,
  onNewChat,
  onOpenSettings,
}: {
  activeSession: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
    api.listSessions().then((s) => setSessions(Array.isArray(s) ? s : [])).catch(() => setSessions([]));
    api.getAccount().then(setAccount).catch(() => setAccount(null));
  }, []);

  // Agrupa conversas por rótulo de data (Hoje / Ontem / ...).
  const groups = sessions.reduce<Record<string, SessionSummary[]>>((acc, s) => {
    const k = (s as any).group || "Recentes";
    (acc[k] ||= []).push(s);
    return acc;
  }, {});

  return (
    <aside className="flex h-full w-[268px] shrink-0 flex-col border-r border-stroke bg-background px-3 py-4">
      {/* logo */}
      <div className="mb-4 flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white">✦</span>
          <span className="text-base font-semibold text-title">Hermes</span>
        </div>
        <button className="text-text-50 hover:text-title" title="Recolher">▮</button>
      </div>

      <button className="side-item" onClick={onNewChat}>
        <span aria-hidden>✎</span> Novo chat
      </button>
      <button className="side-item">
        <span aria-hidden>⌕</span> Buscar
      </button>

      {/* Projects */}
      <div className="flex items-center justify-between">
        <span className="side-label">Projetos</span>
        <button className="mt-3 mr-1 rounded-md border border-stroke p-1 text-text-50 hover:text-primary" title="Novo projeto">＋</button>
      </div>
      <div className="space-y-0.5">
        {projects.map((p) => (
          <button key={p.id} className="side-convo">
            <span className="flex items-center gap-2 truncate">
              <span aria-hidden className="text-text-50">🗀</span>
              <span className="truncate">{p.name}</span>
            </span>
            <span className="count-pill">{String(p.count ?? 0).padStart(2, "0")}</span>
          </button>
        ))}
      </div>

      {/* Conversas por data */}
      <div className="mt-1 flex-1 overflow-y-auto">
        {Object.entries(groups).map(([label, items]) => (
          <div key={label}>
            <div className="side-label">{label}</div>
            <div className="space-y-0.5">
              {items.map((s) => (
                <button
                  key={s.session_id}
                  onClick={() => onSelectSession(s.session_id)}
                  className={["side-convo", activeSession === s.session_id ? "side-item-active" : ""].join(" ")}
                  title={s.title}
                >
                  <span className="truncate">{s.title || s.session_id}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Cartão de conta */}
      <button
        onClick={onOpenSettings}
        className="mt-3 flex items-center gap-3 rounded-xl bg-gradient-to-r from-background-100 to-primary-light px-3 py-2.5 text-left transition hover:shadow-panel"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
          {(account?.name || "U").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-title">{account?.name || "Cliente"}</span>
          <span className="block truncate text-xs text-text-50">{account?.plan || "Ativo"}</span>
        </span>
        <span className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-primary shadow-sm">⚙</span>
      </button>
    </aside>
  );
}
