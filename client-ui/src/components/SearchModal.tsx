import { useEffect, useState } from "react";
import { Search, Clock, X } from "lucide-react";
import { api, type SessionRow } from "../lib/api";
import { groupSessions, sessionLabel } from "./Sidebar";

// Busca global: sem termo mostra as conversas recentes (lista já carregada);
// com termo consulta GET /api/sessions/search (FTS5 no conteúdo + id).
export function SearchModal({ open, onClose, onSelect, recent }: {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  recent: SessionRow[];
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<(SessionRow & { snippet?: string })[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) { setQ(""); setResults(null); return; }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); return; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      api.searchSessions(term).then((r) => { if (alive) setResults(Array.isArray(r?.results) ? r.results : []); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setBusy(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  if (!open) return null;

  const list = results ?? recent;
  const groups = results ? [["Resultados", results] as [string, SessionRow[]]] : groupSessions(recent);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-safe max-md:pt-[max(1rem,env(safe-area-inset-top))] md:pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-panel shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-stroke px-4 py-3 md:px-5 md:py-4">
          <Search size={18} className="shrink-0 text-text-50" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nas conversas…"
            className="min-w-0 flex-1 bg-transparent text-base text-title outline-none placeholder:text-text-50 sm:text-sm" />
          <button onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-50 hover:bg-background-100 hover:text-title"><X size={18} /></button>
        </div>
        <div className="max-h-[64vh] overflow-y-auto p-3 pb-safe md:max-h-[52vh]">
          {groups.map(([label, items]) => (
            <div key={label} className="mb-3">
              <div className="mb-1 flex items-center gap-2 px-2 text-xs font-medium text-text-50"><Clock size={13} /> {label}</div>
              {items.map((s) => (
                <button key={s.id} onClick={() => { onSelect(s.id); onClose(); }}
                  className="flex w-full min-w-0 flex-col items-start rounded-lg px-3 py-2.5 text-left text-sm text-title hover:bg-background-100">
                  <span className="w-full truncate">{sessionLabel(s)}</span>
                  {(s as any).snippet && <span className="w-full truncate text-xs text-text-50">{(s as any).snippet}</span>}
                </button>
              ))}
            </div>
          ))}
          {!busy && list.length === 0 && <p className="px-3 py-6 text-center text-sm text-text-50">Nenhum resultado.</p>}
          {busy && <p className="px-3 py-2 text-xs text-text-50">Buscando…</p>}
        </div>
        <div className="border-t border-stroke bg-background-50 px-5 py-2.5 text-center text-xs text-text-50">
          Pressione <kbd className="rounded bg-panel px-1.5 py-0.5 shadow-sm">ESC</kbd> para fechar
        </div>
      </div>
    </div>
  );
}
