import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  PanelLeft,
  PencilLine,
  Search,
  FolderPlus,
  Folder,
  Settings,
  Headphones,
  LogOut,
  Monitor,
  Sun,
  Moon,
} from "lucide-react";
import { api, type Account, type Project, type SessionSummary } from "../lib/api";
import { useTheme } from "../lib/theme";

// Sidebar do painel do cliente — estilo AIChat/Tailgrids: logo + colapsar,
// Novo chat, Buscar (abre modal), Projetos com contador e botão +,
// conversas por data, e cartão de conta que abre um menu (Settings / tema / sair).
export function Sidebar({
  collapsed,
  onToggle,
  activeSession,
  onSelectSession,
  onNewChat,
  onOpenSearch,
  onNewProject,
  onOpenSettings,
}: {
  collapsed: boolean;
  onToggle: () => void;
  activeSession: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onOpenSearch: () => void;
  onNewProject: () => void;
  onOpenSettings: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
    api.listSessions().then((s) => setSessions(Array.isArray(s) ? s : [])).catch(() => setSessions([]));
    api.getAccount().then(setAccount).catch(() => setAccount(null));
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const groups = sessions.reduce<Record<string, SessionSummary[]>>((acc, s) => {
    const k = (s as any).group || "Recentes";
    (acc[k] ||= []).push(s);
    return acc;
  }, {});

  // Trilho recolhido: só ícones.
  if (collapsed) {
    return (
      <aside className="flex h-full w-[64px] shrink-0 flex-col items-center border-r border-stroke bg-background py-4">
        <span className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
          <Sparkles size={18} />
        </span>
        <button className="rail-btn" onClick={onToggle} title="Expandir"><PanelLeft size={18} /></button>
        <button className="rail-btn" onClick={onNewChat} title="Novo chat"><PencilLine size={18} /></button>
        <button className="rail-btn" onClick={onOpenSearch} title="Buscar"><Search size={18} /></button>
        <button className="rail-btn" onClick={onNewProject} title="Novo projeto"><FolderPlus size={18} /></button>
        <div className="flex-1" />
        <button onClick={onOpenSettings} className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary" title="Conta">
          {(account?.name || "U").slice(0, 1).toUpperCase()}
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[268px] shrink-0 flex-col border-r border-stroke bg-background px-3 py-4">
      <div className="mb-4 flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white">
            <Sparkles size={16} />
          </span>
          <span className="text-base font-semibold text-title">Hermes</span>
        </div>
        <button className="text-text-50 hover:text-title" onClick={onToggle} title="Recolher">
          <PanelLeft size={18} />
        </button>
      </div>

      <button className="side-item" onClick={onNewChat}>
        <PencilLine size={16} /> Novo chat
      </button>
      <button className="side-item" onClick={onOpenSearch}>
        <Search size={16} /> Buscar
      </button>

      <div className="flex items-center justify-between">
        <span className="side-label">Projetos</span>
        <button className="mt-3 mr-1 rounded-md border border-stroke p-1 text-text-50 hover:text-primary" onClick={onNewProject} title="Novo projeto">
          <FolderPlus size={15} />
        </button>
      </div>
      <div className="space-y-0.5">
        {projects.map((p) => (
          <button key={p.id} className="side-convo">
            <span className="flex items-center gap-2 truncate">
              <Folder size={15} className="text-text-50" />
              <span className="truncate">{p.name}</span>
            </span>
            <span className="count-pill">{String(p.count ?? 0).padStart(2, "0")}</span>
          </button>
        ))}
      </div>

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

      {/* Cartão de conta + menu popover */}
      <div className="relative mt-3" ref={menuRef}>
        {menuOpen && (
          <div className="absolute bottom-16 left-0 right-0 z-20 rounded-xl border border-stroke bg-panel p-1.5 shadow-pop">
            <button className="menu-item" onClick={() => { setMenuOpen(false); onOpenSettings(); }}>
              <Settings size={16} /> Configurações
            </button>
            <button className="menu-item"><Headphones size={16} /> Ajuda</button>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2 text-sm text-text-100"><Sun size={16} /> Tema</span>
              <div className="flex items-center gap-1 rounded-lg border border-stroke p-0.5">
                {([["system", Monitor], ["light", Sun], ["dark", Moon]] as const).map(([id, Icon]) => (
                  <button
                    key={id}
                    onClick={() => setTheme(id)}
                    className={["rounded-md p-1.5", theme === id ? "bg-background-100 text-primary" : "text-text-50"].join(" ")}
                    title={id}
                  >
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </div>
            <div className="my-1 h-px bg-stroke" />
            <button className="menu-item text-red-600"><LogOut size={16} /> Sair</button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-xl bg-gradient-to-r from-background-100 to-primary-light px-3 py-2.5 text-left transition hover:shadow-panel"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
            {(account?.name || "U").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-title">{account?.name || "Cliente"}</span>
            <span className="block truncate text-xs text-text-50">{account?.plan || "Ativo"}</span>
          </span>
          <span className="rounded-md bg-panel px-2.5 py-1 text-xs font-medium text-primary shadow-sm">
            <Settings size={14} />
          </span>
        </button>
      </div>
    </aside>
  );
}
