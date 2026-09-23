import { useEffect, useRef, useState, useCallback } from "react";
import { MoreHorizontal, Trash2, Copy, Sparkles, Wrench, Check, Loader2, AlertTriangle, WifiOff, Menu, ArrowDown } from "lucide-react";
import { Composer } from "./Composer";
import { ChoiceCards } from "./ChoiceCards";
import { useChatSession, type PendingRequest, type UiMessage } from "../lib/useChatSession";
import { gateway, type ConnState } from "../lib/gateway";
import { api } from "../lib/api";

const APPROVAL_LABELS: Record<string, { label: string; description: string }> = {
  once: { label: "Permitir uma vez", description: "Só esta execução" },
  session: { label: "Permitir nesta conversa", description: "Até fechar a conversa" },
  always: { label: "Permitir sempre", description: "Não perguntar mais para este comando" },
  deny: { label: "Negar", description: "O assistente não executa" },
};

// Área central de chat, ligada ao gateway WS. Vazia → hero + composer.
// Com sessão → cabeçalho + mensagens (streaming) + cartões de aprovação/escolha.
export function ChatArea({
  sessionId,
  onOpenNav,
  onSessionCreated,
  onTitle,
  onDeleted,
}: {
  sessionId: string | null;
  onOpenNav?: () => void;
  onSessionCreated: (storedId: string) => void;
  onTitle?: (storedId: string, title: string) => void;
  onDeleted?: (storedId: string) => void;
}) {
  const chat = useChatSession(sessionId, onSessionCreated, onTitle);
  const [menuOpen, setMenuOpen] = useState(false);
  const [conn, setConn] = useState<ConnState>(gateway.state);
  const [atBottom, setAtBottom] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // "Perto do fim" = a menos de 120px do fundo. Enquanto o usuário estiver aí,
  // seguimos a resposta; se ele rolou pra cima pra reler, paramos de sequestrar.
  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setAtBottom(near);
  }, []);

  const scrollToEnd = useCallback((behavior: ScrollBehavior = "smooth") => {
    endRef.current?.scrollIntoView({ behavior });
    setAtBottom(true);
  }, []);

  useEffect(() => gateway.onState(setConn), []);
  // Auto-scroll só quando o usuário já está no fim (evita roubar a rolagem
  // durante o streaming se ele estiver lendo mais acima).
  useEffect(() => { if (atBottom) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat.messages, chat.requests, atBottom]);
  // Ao trocar de conversa, ancora no fim instantaneamente.
  useEffect(() => { setAtBottom(true); endRef.current?.scrollIntoView({ behavior: "auto" }); }, [sessionId]);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const empty = !sessionId && chat.messages.length === 0;
  const currentModel = (chat.info?.model as string) || undefined;

  async function deleteConversation() {
    if (!sessionId) return;
    if (!confirm("Excluir esta conversa? Isso não pode ser desfeito.")) return;
    setMenuOpen(false);
    await gateway.call("session.close", { session_id: chat.runtimeId || sessionId }).catch(() => {});
    await api.deleteSession(sessionId).catch(() => {});
    onDeleted?.(sessionId);
  }

  const composer = (
    <Composer
      onSend={chat.send}
      onStop={chat.interrupt}
      running={chat.running}
      attachments={chat.attachments}
      onAddFiles={chat.addFiles}
      onRemoveAttachment={chat.removeAttachment}
      currentModel={currentModel}
    />
  );

  return (
    <section className="relative flex h-full flex-1 flex-col rounded-2xl bg-panel shadow-panel">
      {conn === "lost" && (
        <div className="flex items-center gap-2 rounded-t-2xl bg-amber-50 px-6 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <WifiOff size={14} /> Conexão com o assistente perdida.
          <button className="underline" onClick={() => gateway.connect().catch(() => {})}>Reconectar</button>
        </div>
      )}
      {!empty && (
        <div className="flex items-center justify-between border-b border-stroke px-4 py-3 pt-safe md:px-6">
          <div className="flex min-w-0 items-center gap-1">
            <button onClick={onOpenNav} className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-100 hover:bg-background-100 md:hidden" title="Menu"><Menu size={20} /></button>
            <span className="truncate text-sm font-medium text-title">{chat.title || "Nova conversa"}</span>
          </div>
          <div className="flex items-center gap-2">
            {chat.running && <span className="flex items-center gap-1 text-xs text-text-50"><Loader2 size={13} className="animate-spin" /> respondendo</span>}
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenuOpen((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-100 hover:bg-background-100" title="Mais">
                <MoreHorizontal size={18} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 z-20 w-52 rounded-xl border border-stroke bg-panel p-1 shadow-pop">
                  <button className="menu-item text-red-600" onClick={deleteConversation} disabled={!sessionId}><Trash2 size={16} /> Excluir conversa</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {empty ? (
        <div className="relative flex flex-1 flex-col items-center justify-center px-6">
          <button onClick={onOpenNav} className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg text-text-100 hover:bg-background-100 md:hidden" title="Menu"><Menu size={20} /></button>
          <h1 className="text-3xl font-semibold text-primary">Como posso ajudar?</h1>
          <p className="mt-3 max-w-md text-center text-sm text-text-50">
            Seu assistente — respostas, conteúdo e conexão dos seus canais, tudo num só lugar.
          </p>
          <div className="mt-8 w-full max-w-2xl">{composer}</div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} onScroll={checkAtBottom} className="relative flex-1 space-y-5 overflow-y-auto px-4 py-6 md:px-6">
            {chat.loading && <p className="text-sm text-text-50">Carregando conversa…</p>}
            {chat.messages.map((m) => <Bubble key={m.key} m={m} />)}
            {chat.requests.map((r) => (
              <div key={r.id} className="max-w-2xl">
                <RequestCard req={r} onApproval={chat.answerApproval} onClarify={chat.answerClarify} />
              </div>
            ))}
            {chat.error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {chat.error}
              </div>
            )}
            <div ref={endRef} />
          </div>
          {/* Botão "ir para o fim": aparece só quando o usuário rolou pra cima.
              Durante o streaming isso evita roubar a leitura e dá o controle de volta. */}
          {!atBottom && (
            <button onClick={() => scrollToEnd("smooth")}
              className="absolute bottom-24 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-stroke bg-panel text-text-100 shadow-pop transition hover:text-primary"
              title="Ir para as mensagens novas">
              <ArrowDown size={18} />
              {chat.running && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary" />}
            </button>
          )}
          <div className="border-t border-stroke p-4 pb-safe-4">{composer}</div>
        </>
      )}
    </section>
  );
}

function RequestCard({ req, onApproval, onClarify }: {
  req: PendingRequest;
  onApproval: (r: PendingRequest, choice: string) => void;
  onClarify: (r: PendingRequest, answer: string, qid?: string) => Promise<void>;
}) {
  const p = req.params || {};
  if (req.method === "approval") {
    const choices: string[] = Array.isArray(p.choices) && p.choices.length ? p.choices : ["once", "deny"];
    return (
      <ChoiceCards
        tone="warning"
        prompt={p.description ? `O assistente quer executar: ${p.description}` : "O assistente pede permissão para executar um comando"}
        detail={p.command || undefined}
        options={choices.map((c) => ({ id: c, ...(APPROVAL_LABELS[c] || { label: c, description: "" }) }))}
        onChoose={(id) => onApproval(req, id)}
      />
    );
  }
  // clarify: pergunta única ou lote
  if (Array.isArray(p.questions) && p.questions.length) {
    return (
      <div className="space-y-3">
        {p.questions.map((q: any) => (
          <ClarifyQuestion key={q.qid} question={q.question} choices={q.choices} answered={p.answers?.[q.qid]}
            onAnswer={(a) => onClarify(req, a, q.qid)} />
        ))}
      </div>
    );
  }
  return <ClarifyQuestion question={p.question || "O assistente tem uma pergunta"} choices={p.choices} onAnswer={(a) => onClarify(req, a)} />;
}

function ClarifyQuestion({ question, choices, answered, onAnswer }: { question: string; choices?: string[] | null; answered?: string; onAnswer: (a: string) => Promise<void> | void }) {
  const [free, setFree] = useState("");
  const [done, setDone] = useState<string | null>(answered ?? null);
  if (done !== null) {
    return (
      <div className="rounded-xl border border-stroke bg-background-50 px-4 py-3 text-sm text-text-200">
        <span className="text-xs text-text-50">{question}</span>
        <div className="mt-1 flex items-center gap-2 text-title"><Check size={14} className="text-primary" /> {done || "(pulado)"}</div>
      </div>
    );
  }
  const opts = Array.isArray(choices) && choices.length ? choices : null;
  return (
    <div className="space-y-2">
      {opts ? (
        <ChoiceCards prompt={question} options={opts.map((c) => ({ id: c, label: c }))} onChoose={async (id) => { await onAnswer(id); setDone(id); }} />
      ) : (
        <div className="rounded-xl border border-stroke border-l-4 border-l-primary bg-panel p-4 shadow-panel">
          <p className="mb-3 text-sm font-medium text-title">{question}</p>
          <div className="flex gap-2">
            <input value={free} onChange={(e) => setFree(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && free.trim()) { await onAnswer(free.trim()); setDone(free.trim()); } }}
              placeholder="Sua resposta…" className="min-w-0 flex-1 rounded-lg border border-stroke bg-background-50 px-3 py-2.5 text-base text-title outline-none focus:border-primary sm:text-sm" />
            <button className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50" disabled={!free.trim()}
              onClick={async () => { await onAnswer(free.trim()); setDone(free.trim()); }}>Responder</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ m }: { m: UiMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl bg-primary px-4 py-2.5 text-sm leading-relaxed text-white sm:max-w-[75%]">{m.text}</div>
      </div>
    );
  }
  if (m.role === "tool") {
    return (
      <div className="flex items-center gap-2 pl-11 text-xs text-text-50">
        {m.toolDone ? <Wrench size={13} /> : <Loader2 size={13} className="animate-spin" />}
        <span className="font-medium">{m.toolName || "ferramenta"}</span>
        {m.text && <span className="truncate">— {m.text}</span>}
      </div>
    );
  }
  return (
    <div className="flex max-w-full gap-2 sm:max-w-[85%] sm:gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Sparkles size={16} />
      </span>
      <div className="min-w-0">
        <div className="mb-1 text-xs font-medium text-text-50">Assistente</div>
        <div className="whitespace-pre-wrap break-words rounded-2xl bg-background-50 px-4 py-2.5 text-sm leading-relaxed text-text-200">
          {m.text}
          {m.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary/60 align-text-bottom" />}
        </div>
        {m.error && <div className="mt-1 text-xs text-red-600">{m.error}</div>}
        {!m.streaming && m.text && (
          <div className="mt-1.5 flex items-center gap-1 text-text-50">
            <button onClick={() => navigator.clipboard?.writeText(m.text)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-background-100 hover:text-text-200" title="Copiar"><Copy size={15} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
