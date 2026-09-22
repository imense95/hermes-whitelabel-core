import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Send, Check, Loader2 } from "lucide-react";
import { api } from "../lib/api";

type TgState = "idle" | "starting" | "awaiting" | "connected" | "error";

// Conexão do Telegram — nativo do Hermes (plugins/platforms/telegram no upstream).
// Fluxo real de onboarding do upstream (/api/messaging/telegram/onboarding/*):
// start -> {pairing_id, deep_link, qr_payload}; o usuário abre o deep-link /
// escaneia o QR e autoriza no app do Telegram; polling detecta a conexão; apply
// grava o token no .env e reinicia. O token nunca passa pelo front.
export function TelegramTab() {
  const [state, setState] = useState<TgState>("idle");
  const [deepLink, setDeepLink] = useState<string>("");
  const [qr, setQr] = useState<string>("");
  const [username, setUsername] = useState<string | undefined>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pairingRef = useRef<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tg") === "start") {
      const t = setTimeout(() => start(), 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Desenha o QR quando o canvas já está montado (state=awaiting) e há payload.
  useEffect(() => {
    if (state === "awaiting" && qr && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qr, { width: 200, margin: 1 }).catch(() => {});
    }
  }, [state, qr]);

  async function start() {
    setState("starting");
    try {
      const r = await api.tgStart();
      pairingRef.current = r.pairing_id;
      setDeepLink(r.deep_link);
      if (r.qr_payload) setQr(r.qr_payload);
      setState("awaiting");
      pollRef.current = setInterval(async () => {
        const id = pairingRef.current;
        if (!id) return;
        const s = await api.tgStatus(id).catch(() => null);
        if (!s) return;
        if (s.status === "connected") { await finish(s.username); }
      }, 2500);
    } catch {
      if (pollRef.current) clearInterval(pollRef.current);
      setState("error");
    }
  }

  async function finish(user?: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    if (pairingRef.current) await api.tgApply(pairingRef.current).catch(() => {});
    setUsername(user);
    setState("connected");
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="tg-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#229ED9]/10 text-[#229ED9]">
            <Send size={20} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-title">Telegram</h2>
            <p className="text-sm text-text-50">Conecte um bot via @BotFather.</p>
          </div>
          {state === "connected" && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
              <Check size={13} /> Conectado
            </span>
          )}
        </div>

        {state === "connected" ? (
          <div className="mt-5 rounded-lg border border-stroke bg-background-50 px-4 py-3 text-sm text-text-200">
            Bot ativo{username ? <> como <b className="text-title">{username}</b></> : null}.
            Botões inline (escolha visual) já funcionam nas conversas.
          </div>
        ) : state === "awaiting" ? (
          <div className="mt-5 flex flex-col items-center">
            <p className="mb-4 text-center text-sm text-text-100">
              Escaneie o QR com o Telegram ou abra o link abaixo e autorize o bot.
            </p>
            <canvas ref={canvasRef} className="rounded-lg" />
            {deepLink && (
              <a href={deepLink} target="_blank" rel="noreferrer" className="btn-outline mt-4">
                Abrir no Telegram
              </a>
            )}
            <p className="mt-3 flex items-center gap-2 text-xs text-text-50">
              <Loader2 size={13} className="animate-spin" /> Aguardando autorização…
            </p>
          </div>
        ) : (
          <>
            <ol className="mt-5 space-y-2 text-sm text-text-100">
              <li>1. Clique em <b className="text-title">Iniciar conexão</b>.</li>
              <li>2. Escaneie o QR ou abra o link — o Telegram abre no @BotFather.</li>
              <li>3. Autorize; o bot conecta sozinho. Botões inline já funcionam.</li>
            </ol>
            <button className="btn mt-5 w-full" disabled={state === "starting"} onClick={start}>
              {state === "starting" ? <><Loader2 size={16} className="animate-spin" /> Iniciando…</> : "Iniciar conexão"}
            </button>
            {state === "error" && (
              <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                Não foi possível iniciar a conexão agora. Tente novamente.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
