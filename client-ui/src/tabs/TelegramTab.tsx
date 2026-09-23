import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Send, Loader2 } from "lucide-react";
import { api, type ApplyResult } from "../lib/api";
import { usePlatform } from "../lib/usePlatform";
import { ApplyNotice, ErrorNotice, StatusBadge } from "../components/ChannelBits";

type Step = "idle" | "starting" | "awaiting" | "ready" | "activating" | "done" | "error";

// Telegram — fluxo real do upstream (/api/messaging/telegram/onboarding/*):
// start -> {pairing_id, deep_link, qr_payload}; status "waiting" até o usuário
// autorizar no app; "ready" traz bot_username (e owner_user_id quando o serviço
// de pairing informa). apply EXIGE allowed_user_ids — só esses IDs numéricos
// falam com o bot (allowlist obrigatória; nunca "todo mundo").
// O ESTADO mostrado vem de GET /api/messaging/platforms (fonte de verdade).
export function TelegramTab() {
  const plat = usePlatform("telegram");
  const [step, setStep] = useState<Step>("idle");
  const [deepLink, setDeepLink] = useState("");
  const [qr, setQr] = useState("");
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [userIds, setUserIds] = useState("");
  const [apply, setApply] = useState<ApplyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pairingRef = useRef<string | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
  useEffect(() => {
    if (step === "awaiting" && qr && canvasRef.current) QRCode.toCanvas(canvasRef.current, qr, { width: 200, margin: 1 }).catch(() => {});
  }, [step, qr]);

  async function start() {
    setErr(null); setApply(null); setStep("starting");
    try {
      const r = await api.tgStart();
      pairingRef.current = r.pairing_id;
      setDeepLink(r.deep_link);
      if (r.qr_payload) setQr(r.qr_payload);
      setStep("awaiting");
      pollRef.current = setInterval(async () => {
        const id = pairingRef.current;
        if (!id) return;
        try {
          const s = await api.tgStatus(id);
          if (s.status === "ready") {
            if (pollRef.current) clearInterval(pollRef.current);
            setBotUsername(s.bot_username || null);
            if (s.owner_user_id && !userIds) setUserIds(s.owner_user_id);
            setStep("ready");
          }
        } catch (e: any) {
          // 410 = expirado/claimed; 404 = sessão sumiu (reinício do dashboard)
          if (pollRef.current) clearInterval(pollRef.current);
          setErr(e?.message || "sessão de conexão expirou"); setStep("error");
        }
      }, 2500);
    } catch (e: any) {
      if (pollRef.current) clearInterval(pollRef.current);
      setErr(e?.message || "não foi possível iniciar"); setStep("error");
    }
  }

  const ids = userIds.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const idsValid = ids.length > 0 && ids.every((s) => /^\d{3,20}$/.test(s));

  async function activate() {
    if (!pairingRef.current || !idsValid) return;
    setStep("activating"); setErr(null);
    try {
      const r = await api.tgApply(pairingRef.current, ids);
      setApply(r); setStep("done");
      plat.watchUntilSettled();
    } catch (e: any) {
      setErr(e?.message || "falha ao ativar"); setStep("ready");
    }
  }

  async function disable() {
    if (!confirm("Desligar o Telegram? O bot para de responder após o reinício do serviço.")) return;
    setErr(null);
    try {
      if (pairingRef.current) await api.tgCancel(pairingRef.current).catch(() => {});
      await api.platformSetEnabled("telegram", false);
      setStep("idle"); setApply(null);
      await plat.refresh();
    } catch (e: any) { setErr(e?.message || "falha ao desligar"); }
  }

  const info = plat.info;
  const active = !!info?.enabled && info.configured;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="tg-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#229ED9]/10 text-[#229ED9]"><Send size={20} /></span>
          <div>
            <h2 className="text-base font-semibold text-title">Telegram</h2>
            <p className="text-sm text-text-50">Conecte um bot via @BotFather.</p>
          </div>
          {plat.loading ? <Loader2 size={14} className="ml-auto animate-spin text-text-50" /> : <StatusBadge info={info} />}
        </div>

        {active && (
          <div className="mt-5 space-y-3">
            <div className="rounded-lg border border-stroke bg-background-50 px-4 py-3 text-sm text-text-200">
              Bot configurado{botUsername ? <> como <b className="text-title">@{botUsername.replace(/^@/, "")}</b></> : null}. Só os IDs autorizados conversam com ele. Botões inline (escolha visual) já funcionam.
              {info?.error_message && <p className="mt-1 text-xs text-red-600">{info.error_message}</p>}
              {info?.state === "pending_restart" && <p className="mt-1 text-xs text-text-50">Configuração salva; o serviço ainda não reiniciou.</p>}
            </div>
            <ApplyNotice r={apply} />
            <button className="btn-outline w-full" onClick={disable}>Desligar Telegram</button>
          </div>
        )}

        {!active && (step === "ready" || step === "activating") && (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg border border-stroke bg-background-50 px-4 py-3 text-sm text-text-200">
              Bot autorizado{botUsername ? <> (<b className="text-title">@{botUsername.replace(/^@/, "")}</b>)</> : null}.
            </div>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-text-50">Quem pode falar com o bot (ID numérico do Telegram)</span>
              <input value={userIds} onChange={(e) => setUserIds(e.target.value)} placeholder="ex.: 123456789 (vários: separe por vírgula)"
                className="mt-1 w-full rounded-lg border border-stroke bg-background-50 px-3 py-2 text-sm text-title outline-none focus:border-primary" />
              <span className="mt-1 block text-xs text-text-50">Descubra o seu ID mandando <code>/start</code> para <b>@userinfobot</b> no Telegram. Só esses IDs conversam com o bot; qualquer outra pessoa é ignorada.</span>
              {userIds && !idsValid && <span className="mt-1 block text-xs text-red-600">Só números (3 a 20 dígitos), separados por vírgula.</span>}
            </label>
            <button className="btn w-full" disabled={step === "activating" || !idsValid} onClick={activate}>
              {step === "activating" ? <><Loader2 size={16} className="animate-spin" /> Ativando…</> : "Confirmar e ativar"}
            </button>
          </div>
        )}

        {!active && step === "done" && (
          <div className="mt-5 space-y-3">
            <ApplyNotice r={apply} />
            <p className="text-xs text-text-50">Aguardando o serviço voltar… (o status acima atualiza sozinho)</p>
          </div>
        )}

        {!active && step === "awaiting" && (
          <div className="mt-5 flex flex-col items-center">
            <p className="mb-4 text-center text-sm text-text-100">Escaneie o QR com o Telegram ou abra o link abaixo e autorize o bot.</p>
            <canvas ref={canvasRef} className="rounded-lg" />
            {deepLink && <a href={deepLink} target="_blank" rel="noreferrer" className="btn-outline mt-4">Abrir no Telegram</a>}
            <p className="mt-3 flex items-center gap-2 text-xs text-text-50"><Loader2 size={13} className="animate-spin" /> Aguardando autorização…</p>
          </div>
        )}

        {!active && (step === "idle" || step === "starting" || step === "error") && (
          <>
            <ol className="mt-5 space-y-2 text-sm text-text-100">
              <li>1. Clique em <b className="text-title">Iniciar conexão</b>.</li>
              <li>2. Escaneie o QR ou abra o link — o Telegram abre no @BotFather.</li>
              <li>3. Autorize, informe o seu ID e confirme. Só você (e quem você listar) fala com o bot.</li>
            </ol>
            <button className="btn mt-5 w-full" disabled={step === "starting"} onClick={start}>
              {step === "starting" ? <><Loader2 size={16} className="animate-spin" /> Iniciando…</> : "Iniciar conexão"}
            </button>
          </>
        )}

        <div className="mt-3"><ErrorNotice msg={err || plat.error} /></div>
      </div>
    </div>
  );
}
