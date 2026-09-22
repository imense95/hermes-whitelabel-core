import { useState } from "react";
import { SessionsTab } from "./tabs/SessionsTab";
import { TokensTab } from "./tabs/TokensTab";
import { TelegramTab } from "./tabs/TelegramTab";
import { WhatsAppTab } from "./tabs/WhatsAppTab";
import { ChoiceCards } from "./components/ChoiceCards";

type TabId = "sessions" | "tokens" | "telegram" | "whatsapp" | "demo";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "sessions", label: "Sessões", icon: "💬" },
  { id: "tokens", label: "Tokens", icon: "🔑" },
  { id: "telegram", label: "Telegram", icon: "✈" },
  { id: "whatsapp", label: "WhatsApp", icon: "⬤" },
  { id: "demo", label: "Escolha visual", icon: "▦" },
];

export default function App() {
  const initial = (new URLSearchParams(window.location.search).get("tab") as TabId) || "sessions";
  const [tab, setTab] = useState<TabId>(
    TABS.some((t) => t.id === initial) ? initial : "sessions",
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-stroke bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-white">H</span>
            <span className="text-base font-semibold text-dark">Hermes</span>
          </div>
          <span className="text-xs text-body">Painel do cliente</span>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-8">
        <nav className="flex w-48 flex-col gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={["tg-tab", tab === t.id ? "tg-tab-active" : ""].join(" ")}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        <main className="flex-1">
          {tab === "sessions" && <SessionsTab />}
          {tab === "tokens" && <TokensTab />}
          {tab === "telegram" && <TelegramTab />}
          {tab === "whatsapp" && <WhatsAppTab />}
          {tab === "demo" && (
            <div className="mx-auto max-w-2xl space-y-4">
              <p className="text-sm text-body">
                Prévia do componente de escolha visual — o que a skill mostra no chat
                web em vez de pedir para digitar a opção (enquete no WhatsApp, botão
                inline no Telegram).
              </p>
              <ChoiceCards
                prompt="Qual variação de arte publicar hoje?"
                options={[
                  { id: "v1", label: "Variação 1", description: "Fundo escuro, foco no símbolo" },
                  { id: "v2", label: "Variação 2", description: "Fundo claro, wordmark completo" },
                  { id: "later", label: "Depois", description: "Reagendar para amanhã" },
                ]}
                onChoose={(id) => alert(`Escolhido: ${id} (na integração real → api.answerApproval)`)}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
