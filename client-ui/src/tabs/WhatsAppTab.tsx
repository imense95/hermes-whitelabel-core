import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { MessageCircle, Check, Loader2 } from "lucide-react";
import { api } from "../lib/api";

type WaState = "idle" | "starting" | "awaiting_qr" | "paired" | "activating" | "connected" | "error";

// Conexão do WhatsApp por QR Code (bridge Baileys — decisão do cliente, ciente
// do risco de ban por ser não-oficial). O bridge Node roda ISOLADO (processo
// separado, fora do agente). Usa as rotas reais do upstream:
// POST /api/messaging/whatsapp/onboarding/start -> {pairing_id}
// GET  /api/messaging/whatsapp/onboarding/{id}  -> {status, qr_payload, account_phone}
// POST .../{id}/apply -> grava .env + reinicia gateway.
export function WhatsAppTab() {
  const [state, setState] = useState<WaState>("idle");
  const [number, setNumber] = useState<string | undefined>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pairingRef = useRef<string | null>(null);

  // Auto-inicia o pareamento em teste (?wa=start). Sem efeito em produção.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("wa") === "start") {
      const t = setTimeout(() => startPairing(), 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function drawQr(qr: string) {
    if (canvasRef.current) {
      await QRCode.toCanvas(canvasRef.current, qr, { width: 224, margin: 1 }).catch(() => {});
    }
  }

  async function startPairing() {
    setState("starting");
    try {
      const start = await api.waStart();
      pairingRef.current = start.pairing_id;
      // O upstream pode retornar "connected" já no start (creds.json no volume de
      // um pareamento anterior). NÃO aplicar sozinho: pede confirmação explícita.
      if (start.status === "connected") {
        setNumber(start.account_phone || undefined);
        setState("paired");
        return;
      }
      setState("awaiting_qr");
      // polling do status/QR a cada 2.5s
      pollRef.current = setInterval(async () => {
        const id = pairingRef.current;
        if (!id) return;
        const s = await api.waStatus(id).catch(() => null);
        if (!s) return;
        if (s.status === "connected") {
          if (pollRef.current) clearInterval(pollRef.current);
          setNumber(s.account_phone || undefined);
          setState("paired"); // pareado — aguarda o usuário confirmar a ativação
          return;
        }
        if (s.status === "expired") { fail(); return; }
        if (s.qr_payload) await drawQr(s.qr_payload);
      }, 2500);
    } catch {
      fail();
    }
  }

  function fail() {
    if (pollRef.current) clearInterval(pollRef.current);
    setState("error");
  }

  // Ação EXPLÍCITA do usuário: grava o .env (WHATSAPP_ENABLED=true) e reinicia o
  // gateway. Nunca automática — reiniciar o serviço é decisão consciente.
  async function activate() {
    if (!pairingRef.current) return;
    setState("activating");
    try {
      await api.waApply(pairingRef.current);
      setState("connected");
    } catch {
      // 409 (ainda não conectado) ou erro de rede: volta para pareado.
      setState("paired");
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="tg-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366]/10 text-[#25D366]">
            <MessageCircle size={20} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-title">WhatsApp</h2>
            <p className="text-sm text-text-50">Pareie escaneando um QR Code.</p>
          </div>
          {(state === "connected" || state === "paired") && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
              <Check size={13} /> {state === "connected" ? "Ativo" : "Pareado"}
            </span>
          )}
        </div>

        {state === "connected" ? (
          <div className="mt-5 rounded-lg border border-stroke bg-background-50 px-4 py-3 text-sm text-text-200">
            Número pareado{number ? <> (<b className="text-title">{number}</b>)</> : null} e canal ativo.
            Enquetes (escolha visual) já funcionam nas conversas.
          </div>
        ) : state === "paired" || state === "activating" ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg border border-stroke bg-background-50 px-4 py-3 text-sm text-text-200">
              Número pareado{number ? <> (<b className="text-title">{number}</b>)</> : null}.
              Confirme para ativar o canal — isso grava a configuração e <b>reinicia o serviço</b>.
            </div>
            <button className="btn w-full" disabled={state === "activating"} onClick={activate}>
              {state === "activating" ? <><Loader2 size={16} className="animate-spin" /> Ativando…</> : "Confirmar e ativar"}
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5 flex flex-col items-center">
              <div className="flex h-56 w-56 items-center justify-center rounded-lg border-2 border-dashed border-stroke bg-background-50">
                {state === "awaiting_qr" ? (
                  <canvas ref={canvasRef} className="rounded" />
                ) : state === "starting" ? (
                  <span className="flex items-center gap-2 text-sm text-text-50"><Loader2 size={16} className="animate-spin" /> Gerando QR…</span>
                ) : (
                  <span className="px-6 text-center text-xs text-text-50">
                    O QR Code aparece aqui após iniciar o pareamento.
                  </span>
                )}
              </div>
              <button className="btn mt-5 w-full" disabled={state === "starting" || state === "awaiting_qr"} onClick={startPairing}>
                {state === "awaiting_qr" ? "Aguardando leitura…" : "Iniciar pareamento"}
              </button>
            </div>

            <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              <b>Atenção:</b> conexão não-oficial (Baileys). Use um número dedicado —
              há risco de bloqueio pela Meta. O bridge roda isolado do agente.
            </p>

            {state === "error" && (
              <p className="mt-2 text-xs text-text-50">Não foi possível parear agora (QR expirado ou erro). Tente novamente.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
