import { useEffect, useState } from "react";
import { Search, Clock, X } from "lucide-react";
import { api, type SessionSummary } from "../lib/api";

// Modal de busca global — "Search anything", resultados agrupados por data,
// ESC fecha (espelha o command-palette do demo AIChat).
export function SearchModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    if (open) api.listSessions().then((s) => setSessions(Array.isArray(s) ? s : [])).catch(() => setSessions([]));
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = sessions.filter((s) => (s.title || "").toLowerCase().includes(q.toLowerCase()));
  const groups = filtered.reduce<Record<string, SessionSummary[]>>((acc, s) => {
    const k = (s as any).group || "Recentes";
    (acc[k] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-stroke px-5 py-4">
          <Search size={18} className="text-text-50" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar em tudo…"
            className="flex-1 bg-transparent text-sm text-title outline-none placeholder:text-text-50"
          />
          <button onClick={onClose} className="text-text-50 hover:text-title"><X size={18} /></button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-3">
          {Object.entries(groups).map(([label, items]) => (
            <div key={label} className="mb-3">
              <div className="mb-1 flex items-center gap-2 px-2 text-xs font-medium text-text-50">
                <Clock size={13} /> {label}
              </div>
              {items.map((s) => (
                <button
                  key={s.session_id}
                  onClick={() => { onSelect(s.session_id); onClose(); }}
                  className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-title hover:bg-background-100"
                >
                  {s.title || s.session_id}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-text-50">Nenhum resultado.</p>}
        </div>

        <div className="border-t border-stroke bg-background-50 px-5 py-2.5 text-center text-xs text-text-50">
          Pressione <kbd className="rounded bg-white px-1.5 py-0.5 shadow-sm">ESC</kbd> para fechar
        </div>
      </div>
    </div>
  );
}
