import { useEffect, useState } from "react";
import { api, ApiError, type SessionSummary } from "../lib/api";

// Aba de sessões: lista as conversas da instância e abre uma. Chat real
// (mensagens via /api/sessions/{id}/messages). Streaming entra na fatia 2.
export function SessionsTab() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSessions()
      .then((s) => setSessions(Array.isArray(s) ? s : []))
      .catch((e) =>
        setError(e instanceof ApiError && e.status === 401 ? "Faça login para ver as sessões." : String(e)),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonList />;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="tg-card p-0">
        <header className="border-b border-stroke px-5 py-4">
          <h2 className="text-sm font-semibold text-dark">Sessões</h2>
        </header>
        <ul className="max-h-[70vh] divide-y divide-stroke overflow-y-auto">
          {sessions.length === 0 && (
            <li className="px-5 py-6 text-sm text-body">Nenhuma sessão ainda.</li>
          )}
          {sessions.map((s) => (
            <li key={s.session_id}>
              <button
                onClick={() => setActive(s.session_id)}
                className={[
                  "w-full px-5 py-4 text-left transition hover:bg-primary-light",
                  active === s.session_id ? "bg-primary-light" : "",
                ].join(" ")}
              >
                <p className="truncate text-sm font-medium text-dark">
                  {s.title || s.session_id}
                </p>
                <p className="mt-0.5 text-xs text-body">
                  {s.message_count ?? 0} mensagens
                  {s.updated_at ? ` · ${new Date(s.updated_at).toLocaleString("pt-BR")}` : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="tg-card min-h-[60vh]">
        {active ? (
          <ChatView sessionId={active} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-body">
            Selecione uma sessão à esquerda.
          </div>
        )}
      </section>
    </div>
  );
}

function ChatView({ sessionId }: { sessionId: string }) {
  const [msgs, setMsgs] = useState<{ role: string; content: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getMessages(sessionId)
      .then((m) => setMsgs(Array.isArray(m) ? m : []))
      .catch(() => setMsgs([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <p className="text-sm text-body">Carregando conversa…</p>;

  return (
    <div className="flex flex-col gap-4">
      {msgs.map((m, i) => (
        <div
          key={i}
          className={m.role === "user" ? "self-end text-right" : "self-start"}
        >
          <span className="mb-1 block text-xs text-body">{m.role}</span>
          <div
            className={[
              "inline-block max-w-[36rem] rounded-lg px-4 py-2 text-sm",
              m.role === "user" ? "bg-primary text-white" : "bg-surface text-dark",
            ].join(" ")}
          >
            {m.content}
          </div>
        </div>
      ))}
      {msgs.length === 0 && <p className="text-sm text-body">Conversa vazia.</p>}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="tg-card space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-surface" />
        ))}
      </div>
      <div className="tg-card h-[60vh] animate-pulse bg-surface/50" />
    </div>
  );
}
