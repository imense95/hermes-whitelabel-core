import { useEffect, useRef, useState } from "react";
import { Sparkles, PanelLeft, PencilLine, Search, Settings, LogOut, Monitor, Sun, Moon, RefreshCw, X } from "lucide-react";
import { api, type AuthMe, type SessionRow } from "../lib/api";
import { useTheme } from "../lib/theme";

// Agrupa por data de última atividade (segundos epoch, como o dashboard devolve).
export function groupSessions(rows: SessionRow[]): [string, SessionRow[]][] {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const week = today - 6 * 86_400_000;
  const groups: Record<string, SessionRow[]> = {};
  for (const s of rows) {
    const t = ((s.last_active ?? s.started_at) || 0) * 1000;
    const k = t >= today ? "Hoje" : t >= yesterday ? "Ontem" : t >= week ? "Últimos 7 dias" : "Anteriores";
    (groups[k] ||= []).push(s);
  }
  return (["Hoje", "Ontem", "Últimos 7 dias", "Anteriores"] as const).filter((k) => groups[k]).map((k) => [k, groups[k]]);
}

export function sessionLabel(s: SessionRow): string {
  return (s.title || s.preview || "").trim() || `Conversa ${s.id.slice(0, 8)}`;
}

export function Sidebar({
  collapsed,
  onToggle,
  mobile,
  onCloseMobile,
  activeSession,
  sessions,
  loadingSessions,
  onRefresh,
  onSelectSession,
  onNewChat,
  onOpenSearch,
  onOpenSettings,
  account,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onCloseMobile?: () => void;
  activeSession: string | null;
  sessions: SessionRow[];
  loadingSessions: boolean;
  onRefresh: () => void;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  account: AuthMe | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const name = account?.display_name || account?.email || "Cliente";
  const initial = name.slice(0, 1).toUpperCase();

  if (collapsed && !mobile) {
    return (
      <aside className="flex h-full w-[64px] shrink-0 flex-col items-center border-r border-stroke bg-background py-4">
        <span className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white"><Sparkles size={18} /></span>
        <button className="rail-btn" onClick={onToggle} title="Expandir"><PanelLeft size={18} /></button>
        <button className="rail-btn" onClick={onNewChat} title="Nova conversa"><PencilLine size={18} /></button>
        <button className="rail-btn" onClick={onOpenSearch} title="Buscar"><Search size={18} /></button>
        <div className="flex-1" />
        <button onClick={onOpenSettings} className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary" title={name}>{initial}</button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[268px] shrink-0 flex-col border-r border-stroke bg-background px-3 py-4 pt-safe max-md:w-[84vw] max-md:max-w-[320px]">
      <div className="mb-4 flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white"><Sparkles size={16} /></span>
          <span className="text-base font-semibold text-title">Hermes</span>
        </div>
        {mobile ? (
          <button className="flex h-10 w-10 items-center justify-center rounded-lg text-text-50 hover:bg-background-100 hover:text-title" onClick={onCloseMobile} title="Fechar"><X size={20} /></button>
        ) : (
          <button className="text-text-50 hover:text-title" onClick={onToggle} title="Recolher"><PanelLeft size={18} /></button>
        )}
      </div>

      <button className="side-item" onClick={onNewChat}><PencilLine size={16} /> Nova conversa</button>
      <button className="side-item" onClick={onOpenSearch}><Search size={16} /> Buscar</button>

      <div className="mt-1 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between pr-1">
          <span className="side-label">Conversas</span>
          <button onClick={onRefresh} className="mt-3 rounded-md p-1 text-text-50 hover:text-primary" title="Atualizar">
            <RefreshCw size={13} className={loadingSessions ? "animate-spin" : ""} />
          </button>
        </div>
        {!loadingSessions && sessions.length === 0 && (
          <p className="px-3 py-2 text-xs text-text-50">Nenhuma conversa ainda. Comece uma nova.</p>
        )}
        {groupSessions(sessions).map(([label, items]) => (
          <div key={label}>
            <div className="side-label">{label}</div>
            <div className="space-y-0.5">
              {items.map((s) => (
                <button key={s.id} onClick={() => onSelectSession(s.id)}
                  className={["side-convo", activeSession === s.id ? "side-item-active" : ""].join(" ")} title={sessionLabel(s)}>
                  <span className="truncate">{sessionLabel(s)}</span>
                  {s.is_active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title="ativa" />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="relative mt-3" ref={menuRef}>
        {menuOpen && (
          <div className="absolute bottom-16 left-0 right-0 z-20 rounded-xl border border-stroke bg-panel p-1.5 shadow-pop">
            <button className="menu-item" onClick={() => { setMenuOpen(false); onOpenSettings(); }}><Settings size={16} /> Configurações</button>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2 text-sm text-text-100"><Sun size={16} /> Tema</span>
              <div className="flex items-center gap-1 rounded-lg border border-stroke p-0.5">
                {([["system", Monitor], ["light", Sun], ["dark", Moon]] as const).map(([id, Icon]) => (
                  <button key={id} onClick={() => setTheme(id)} className={["rounded-md p-1.5", theme === id ? "bg-background-100 text-primary" : "text-text-50"].join(" ")} title={id}><Icon size={14} /></button>
                ))}
              </div>
            </div>
            <div className="my-1 h-px bg-stroke" />
            <button className="menu-item text-red-600" onClick={() => api.logout()}><LogOut size={16} /> Sair</button>
          </div>
        )}
        <button onClick={() => setMenuOpen((v) => !v)} className="flex w-full items-center gap-3 rounded-xl bg-gradient-to-r from-background-100 to-primary-light px-3 py-2.5 text-left transition hover:shadow-panel">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{initial}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-title">{name}</span>
            <span className="block truncate text-xs text-text-50">{account?.email && account.display_name ? account.email : "Conectado"}</span>
          </span>
          <span className="rounded-md bg-panel px-2.5 py-1 text-xs font-medium text-primary shadow-sm"><Settings size={14} /></span>
        </button>
      </div>
    </aside>
  );
}
