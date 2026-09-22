import { useEffect, useRef, useState } from "react";
import { api, type ChatMessage } from "../lib/api";
import { Composer } from "./Composer";
import { ChoiceCards } from "./ChoiceCards";

const QUICK = [
  { icon: "⌕", label: "Busca profunda" },
  { icon: "🖼", label: "Criar imagens" },
  { icon: "🗞", label: "Últimas notícias" },
  { icon: "▷", label: "Gerar vídeo" },
];

// Área central de chat. Vazia → hero "Como posso ajudar?" + composer centralizado
// + pills de ação. Com sessão → mensagens roladas + composer no rodapé.
export function ChatArea({ sessionId }: { sessionId: string | null }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [showChoice, setShowChoice] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) {
      setMsgs([]);
      return;
    }
    setLoading(true);
    api
      .getMessages(sessionId)
      .then((m) => setMsgs(Array.isArray(m) ? m : []))
      .catch(() => setMsgs([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, showChoice]);

  async function send(text: string) {
    setMsgs((m) => [...m, { role: "user", content: text }]);
    // demonstra o componente de escolha visual quando o texto sugere uma decisão
    if (/qual|escolh|opç|variaç/i.test(text)) {
      setTimeout(() => setShowChoice(true), 250);
      return;
    }
    if (sessionId) {
      const r = await api.sendChat(sessionId, text).catch(() => null);
      if (r?.reply) setMsgs((m) => [...m, { role: "assistant", content: r.reply! }]);
    }
  }

  const empty = !sessionId && msgs.length === 0;

  return (
    <section className="relative flex h-full flex-1 flex-col rounded-2xl bg-white shadow-panel">
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <h1 className="text-3xl font-semibold text-primary">Como posso ajudar?</h1>
          <p className="mt-3 max-w-md text-center text-sm text-text-50">
            Seu assistente Hermes — respostas, conteúdo de marketing e conexão dos
            seus canais, tudo num só lugar.
          </p>
          <div className="mt-8 w-full max-w-2xl">
            <Composer onSend={send} />
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {QUICK.map((q) => (
              <button key={q.label} className="action-pill">
                <span aria-hidden>{q.icon}</span> {q.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
            {loading && <p className="text-sm text-text-50">Carregando conversa…</p>}
            {msgs.map((m, i) => (
              <Bubble key={i} role={m.role} content={m.content} />
            ))}
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
          <div className="border-t border-stroke p-4">
            <Composer onSend={send} />
          </div>
        </>
      )}
    </section>
  );
}

function Bubble({ role, content }: { role: string; content: string }) {
  const isUser = role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div className={isUser ? "max-w-[75%]" : "flex max-w-[80%] gap-3"}>
        {!isUser && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm text-primary">
            ✦
          </span>
        )}
        <div
          className={[
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser ? "bg-primary text-white" : "bg-background-50 text-text-200",
          ].join(" ")}
        >
          {content}
        </div>
      </div>
    </div>
  );
}
