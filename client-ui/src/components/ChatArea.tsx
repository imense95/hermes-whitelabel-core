import { useEffect, useRef, useState } from "react";
import { Search, Image, Newspaper, Play, MoreHorizontal, Share2, Pin, PencilLine, FolderInput, Trash2, Copy, RefreshCw, ThumbsUp, ThumbsDown, Sparkles } from "lucide-react";
import { api, type ChatMessage } from "../lib/api";
import { Composer } from "./Composer";
import { ChoiceCards } from "./ChoiceCards";

const QUICK = [
  { Icon: Search, label: "Busca profunda" },
  { Icon: Image, label: "Criar imagens" },
  { Icon: Newspaper, label: "Últimas notícias" },
  { Icon: Play, label: "Gerar vídeo" },
];

// Área central de chat. Vazia → hero + composer + pills. Com sessão → cabeçalho
// (título, menu ..., Share) + mensagens + composer no rodapé.
export function ChatArea({ sessionId, title }: { sessionId: string | null; title?: string }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [showChoice, setShowChoice] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) { setMsgs([]); return; }
    setLoading(true);
    api.getMessages(sessionId).then((m) => setMsgs(Array.isArray(m) ? m : [])).catch(() => setMsgs([])).finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, showChoice]);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function send(text: string) {
    setMsgs((m) => [...m, { role: "user", content: text }]);
    if (/qual|escolh|opç|variaç/i.test(text)) { setTimeout(() => setShowChoice(true), 250); return; }
    if (sessionId) {
      const r = await api.sendChat(sessionId, text).catch(() => null);
      if (r?.reply) setMsgs((m) => [...m, { role: "assistant", content: r.reply! }]);
    }
  }

  const empty = !sessionId && msgs.length === 0;

  return (
    <section className="relative flex h-full flex-1 flex-col rounded-2xl bg-panel shadow-panel">
      {!empty && (
        <div className="flex items-center justify-between border-b border-stroke px-6 py-3">
          <span className="truncate text-sm font-medium text-title">{title || "Conversa"}</span>
          <div className="flex items-center gap-2">
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenuOpen((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-100 hover:bg-background-100" title="Mais">
                <MoreHorizontal size={18} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 z-20 w-52 rounded-xl border border-stroke bg-panel p-1 shadow-pop">
                  <button className="menu-item"><Pin size={16} /> Fixar</button>
                  <button className="menu-item"><PencilLine size={16} /> Renomear</button>
                  <button className="menu-item"><FolderInput size={16} /> Mover para projeto</button>
                  <button className="menu-item text-red-600"><Trash2 size={16} /> Excluir conversa</button>
                </div>
              )}
            </div>
            <button className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
              <Share2 size={15} /> Compartilhar
            </button>
          </div>
        </div>
      )}

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <h1 className="text-3xl font-semibold text-primary">Como posso ajudar?</h1>
          <p className="mt-3 max-w-md text-center text-sm text-text-50">
            Seu assistente Hermes — respostas, conteúdo de marketing e conexão dos seus canais, tudo num só lugar.
          </p>
          <div className="mt-8 w-full max-w-2xl"><Composer onSend={send} /></div>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {QUICK.map((q) => (
              <button key={q.label} className="action-pill"><q.Icon size={16} /> {q.label}</button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
            {loading && <p className="text-sm text-text-50">Carregando conversa…</p>}
            {msgs.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)}
            {showChoice && (
              <div className="max-w-xl">
                <ChoiceCards
                  prompt="Qual variação de arte publicar hoje?"
                  options={[
                    { id: "v1", label: "Variação 1", description: "Fundo escuro, foco no símbolo" },
                    { id: "v2", label: "Variação 2", description: "Fundo claro, wordmark completo" },
                    { id: "later", label: "Depois", description: "Reagendar para amanhã" },
                  ]}
                  onChoose={(id) => {
                    setShowChoice(false);
                    setMsgs((m) => [...m, { role: "assistant", content: `Perfeito — segui com **${id}**. Publico hoje às 7h.` }]);
                  }}
                />
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="border-t border-stroke p-4"><Composer onSend={send} /></div>
        </>
      )}
    </section>
  );
}

function Bubble({ role, content }: { role: string; content: string }) {
  const isUser = role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl bg-primary px-4 py-2.5 text-sm leading-relaxed text-white">{content}</div>
      </div>
    );
  }
  return (
    <div className="flex max-w-[85%] gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Sparkles size={16} />
      </span>
      <div className="min-w-0">
        <div className="mb-1 text-xs font-medium text-text-50">Hermes</div>
        <div className="rounded-2xl bg-background-50 px-4 py-2.5 text-sm leading-relaxed text-text-200">{content}</div>
        <div className="mt-1.5 flex items-center gap-1 text-text-50">
          {[Copy, RefreshCw, ThumbsUp, ThumbsDown, MoreHorizontal].map((Icon, i) => (
            <button key={i} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-background-100 hover:text-text-200"><Icon size={15} /></button>
          ))}
        </div>
      </div>
    </div>
  );
}
