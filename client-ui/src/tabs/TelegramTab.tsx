import { useEffect, useState } from "react";
import { Send, Check, Loader2 } from "lucide-react";
import { api, type ChannelStatus } from "../lib/api";

// Conexão do Telegram por BOT TOKEN (@BotFather) — nativo do Hermes
// (plugins/platforms/telegram no upstream). O token é segredo: vai para o env
// da instância pela camada segura (Admin API /v1/credentials), nunca ao front.
export function TelegramTab() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [channel, setChannel] = useState<ChannelStatus["telegram"] | null>(null);

  useEffect(() => {
    api.channelStatus().then((c) => setChannel(c.telegram)).catch(() => setChannel(null));
  }, []);

  async function connect() {
    setStatus("saving");
    try {
      await api.connectTelegram(token);
      setToken("");
      const c = await api.channelStatus();
      setChannel(c.telegram);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  const connected = channel?.connected;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="tg-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#229ED9]/10 text-[#229ED9]">
            <Send size={20} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-title">Telegram</h2>
            <p className="text-sm text-text-50">Conecte um bot via token do @BotFather.</p>
          </div>
          {connected && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
              <Check size={13} /> Conectado
            </span>
          )}
        </div>

        {connected ? (
          <div className="mt-5 rounded-lg border border-stroke bg-background-50 px-4 py-3 text-sm text-text-200">
            Bot ativo{channel?.username ? <> como <b className="text-title">{channel.username}</b></> : null}.
            Botões inline (escolha visual) já funcionam nas conversas.
          </div>
        ) : (
          <>
            <ol className="mt-5 space-y-2 text-sm text-text-100">
              <li>1. No Telegram, fale com <b className="text-title">@BotFather</b> → <code>/newbot</code>.</li>
              <li>2. Copie o token que ele fornece.</li>
              <li>3. Cole abaixo e conecte. Botões inline funcionam de imediato.</li>
            </ol>

            <div className="mt-5 space-y-3">
              <input
                className="input"
                type="password"
                placeholder="123456:ABC-DEF..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button className="btn w-full" disabled={!token || status === "saving"} onClick={connect}>
                {status === "saving" ? <><Loader2 size={16} className="animate-spin" /> Conectando…</> : "Conectar Telegram"}
              </button>
            </div>

            {status === "error" && (
              <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                Não foi possível salvar o token agora. Verifique a conexão e tente de novo.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
