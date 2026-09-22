import { useState } from "react";

// Conexão do Telegram por BOT TOKEN (@BotFather). Nativo do Hermes.
// NOTA: o endpoint de provisionamento do bot no backend é da fatia 2
// (POST /api/channels/telegram — a criar). Aqui está o fluxo de UI; ao ligar,
// trocar o handler `connect` pela chamada real.
export function TelegramTab() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "backend-missing">("idle");

  async function connect() {
    setStatus("pending");
    // fatia 2: await api.connectTelegram(token)
    // O token do bot é segredo → vai para o env da instância pela camada segura,
    // nunca fica no localStorage do front.
    setTimeout(() => setStatus("backend-missing"), 400);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="tg-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#229ED9]/10 text-[#229ED9]">
            ✈
          </span>
          <div>
            <h2 className="text-base font-semibold text-dark">Telegram</h2>
            <p className="text-sm text-body">Conecte um bot via token do @BotFather.</p>
          </div>
        </div>

        <ol className="mt-5 space-y-2 text-sm text-body">
          <li>1. No Telegram, fale com <b className="text-dark">@BotFather</b> → <code>/newbot</code>.</li>
          <li>2. Copie o token que ele fornece.</li>
          <li>3. Cole abaixo e conecte. Botões inline funcionam de imediato.</li>
        </ol>

        <div className="mt-5 space-y-3">
          <input
            className="tg-input"
            type="password"
            placeholder="123456:ABC-DEF..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="tg-btn w-full" disabled={!token || status === "pending"} onClick={connect}>
            {status === "pending" ? "Conectando…" : "Conectar Telegram"}
          </button>
        </div>

        {status === "backend-missing" && (
          <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-700">
            UI pronta. O endpoint de provisionamento do bot entra na próxima fatia
            (o gateway do Hermes suporta Telegram por bot token nativamente).
          </p>
        )}
      </div>
    </div>
  );
}
