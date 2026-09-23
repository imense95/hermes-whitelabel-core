import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { MessageCircle, Loader2, ShieldCheck, Users } from "lucide-react";
import { api, type ApplyResult, type WaMode } from "../lib/api";
import { usePlatform } from "../lib/usePlatform";
import { ApplyNotice, ErrorNotice, StatusBadge } from "../components/ChannelBits";

type Step = "idle" | "starting" | "awaiting_qr" | "paired" | "activating" | "done" | "error";

// WhatsApp por QR (bridge Baileys, não-oficial — risco de ban assumido).
// O ESTADO mostrado vem SEMPRE de GET /api/messaging/platforms (fonte de
// verdade); o fluxo de pareamento é só o caminho para chegar lá.
//
// MODO é obrigatório antes de ativar. Padrão "self-chat": o bot responde só no
// chat do próprio número consigo mesmo ("Você") e ignora todo o resto. O modo
// "bot" (DM policy "pairing") responde a QUALQUER número com um código de
// pareamento — foi o que aconteceu no primeiro teste. Nunca deve ser o default.
export function WhatsAppTab() {
  const plat = usePlatform("whatsapp");
  const [step, setStep] = useState<Step>("idle");
  const [mode, setMode] = useState<WaMode>("self-chat");
  const [number, setNumber] = useState<string | undefined>();
  const [apply, setApply] = useState<ApplyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pairingRef = useRef<string | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function drawQr(qr: string) {
    if (canvasRef.current) await QRCode.toCanvas(canvasRef.current, qr, { width: 224, margin: 1 }).catch(() => {});
  }

  async function startPairing() {
    setErr(null); setApply(null); setStep("starting");
    try {
      const start = await api.waStart(mode);
      pairingRef.current = start.pairing_id;
      // creds.json já no volume: o backend devolve connected sem QR. Ainda assim
      // NÃO ativa sozinho — o usuário confirma modo e clica.
      if (start.status === "connected") { setNumber(start.account_phone || undefined); setStep("paired"); return; }
      setStep("awaiting_qr");
      pollRef.current = setInterval(async () => {
        const id = pairingRef.current;
        if (!id) return;
        const s = await api.waStatus(id).catch((e) => ({ status: "expired" as const, error: e?.message, pairing_id: id }));
        if (s.status === "connected") {
          if (pollRef.current) clearInterval(pollRef.current);
          setNumber(s.account_phone || undefined); setStep("paired"); return;
        }
        if (s.status === "expired" || s.status === "error" || s.status === "cancelled") {
          if (pollRef.current) clearInterval(pollRef.current);
          setErr(s.error || "QR expirado. Inicie de novo."); setStep("error"); return;
        }
        if (s.qr_payload) await drawQr(s.qr_payload);
      }, 2500);
    } catch (e: any) {
      setErr(e?.message || "não foi possível iniciar"); setStep("error");
    }
  }

  // Ação EXPLÍCITA: grava WHATSAPP_MODE/ENABLED e reinicia o gateway.
  async function activate() {
    if (!pairingRef.current) return;
    setStep("activating"); setErr(null);
    try {
      const r = await api.waApply(pairingRef.current, mode);
      setApply(r); setStep("done");
      plat.watchUntilSettled();
    } catch (e: any) {
      setErr(e?.message || "falha ao ativar"); setStep("paired");
    }
  }

  async function disable() {
    if (!confirm("Desligar o WhatsApp? O bot para de responder após o reinício do serviço.")) return;
    setErr(null);
    try {
      if (pairingRef.current) await api.waCancel(pairingRef.current).catch(() => {});
      await api.platformSetEnabled("whatsapp", false);
      setStep("idle"); setApply(null);
      await plat.refresh();
    } catch (e: any) { setErr(e?.message || "falha ao desligar"); }
  }

  const info = plat.info;
  const active = !!info?.enabled && info.configured;
  const curMode = info?.whatsapp_setup?.mode;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="tg-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366]/10 text-[#25D366]"><MessageCircle size={20} /></span>
          <div>
            <h2 className="text-base font-semibold text-title">WhatsApp</h2>
            <p className="text-sm text-text-50">Pareie escaneando um QR Code.</p>
          </div>
          {plat.loading ? <Loader2 size={14} className="ml-auto animate-spin text-text-50" /> : <StatusBadge info={info} />}
        </div>

        {/* Estado real, sempre visível quando o canal está ligado */}
        {active && (
          <div className="mt-5 space-y-3">
            <div className="rounded-lg border border-stroke bg-background-50 px-4 py-3 text-sm text-text-200">
              <div className="flex items-center gap-2">
                {curMode === "self-chat" ? <ShieldCheck size={16} className="text-green-600" /> : <Users size={16} className="text-amber-600" />}
                <b className="text-title">{curMode === "self-chat" ? "Só comigo (teste isolado)" : curMode === "bot" ? "Aberto — responde a qualquer número com código de pareamento" : "Modo não definido"}</b>
              </div>
              {info?.error_message && <p className="mt-1 text-xs text-red-600">{info.error_message}</p>}
              {info?.state === "pending_restart" && <p className="mt-1 text-xs text-text-50">Configuração salva; o serviço ainda não reiniciou.</p>}
            </div>
            <ApplyNotice r={apply} />
            <button className="btn-outline w-full" onClick={disable}>Desligar WhatsApp</button>
          </div>
        )}

        {!active && (step === "paired" || step === "activating") && (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg border border-stroke bg-background-50 px-4 py-3 text-sm text-text-200">
              Número pareado{number ? <> (<b className="text-title">{number}</b>)</> : null}. Escolha como o bot vai responder e confirme — isso grava a configuração e <b>reinicia o serviço</b>.
            </div>
            <ModePicker mode={mode} onChange={setMode} />
            <button className="btn w-full" disabled={step === "activating"} onClick={activate}>
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

        {!active && step !== "paired" && step !== "activating" && step !== "done" && (
          <>
            <div className="mt-5"><ModePicker mode={mode} onChange={setMode} /></div>
            <div className="mt-5 flex flex-col items-center">
              <div className="flex h-56 w-56 items-center justify-center rounded-lg border-2 border-dashed border-stroke bg-background-50">
                {step === "awaiting_qr" ? <canvas ref={canvasRef} className="rounded" />
                  : step === "starting" ? <span className="flex items-center gap-2 text-sm text-text-50"><Loader2 size={16} className="animate-spin" /> Gerando QR…</span>
                  : <span className="px-6 text-center text-xs text-text-50">O QR Code aparece aqui após iniciar o pareamento.</span>}
              </div>
              <button className="btn mt-5 w-full" disabled={step === "starting" || step === "awaiting_qr"} onClick={startPairing}>
                {step === "awaiting_qr" ? "Aguardando leitura…" : "Iniciar pareamento"}
              </button>
            </div>
            <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              <b>Atenção:</b> conexão não-oficial (Baileys). Use um número dedicado — há risco de bloqueio pela Meta. O bridge roda isolado do agente.
            </p>
          </>
        )}

        <div className="mt-3"><ErrorNotice msg={err || plat.error} /></div>
      </div>
    </div>
  );
}

function ModePicker({ mode, onChange }: { mode: WaMode; onChange: (m: WaMode) => void }) {
  const opt = (id: WaMode, Icon: typeof ShieldCheck, title: string, desc: string, tone: string) => (
    <button type="button" onClick={() => onChange(id)}
      className={["flex w-full items-start gap-3 rounded-lg border p-3 text-left transition", mode === id ? "border-primary bg-primary-light ring-1 ring-primary" : "border-stroke hover:border-primary"].join(" ")}>
      <Icon size={18} className={`mt-0.5 shrink-0 ${tone}`} />
      <span><span className="block text-sm font-semibold text-title">{title}</span><span className="block text-xs text-text-50">{desc}</span></span>
    </button>
  );
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-50">Quem pode falar com o bot</p>
      {opt("self-chat", ShieldCheck, "Só comigo (recomendado para testar)", "Responde apenas no seu próprio chat (\"Você\"). Ignora qualquer outro número.", "text-green-600")}
      {opt("bot", Users, "Aberto, com aprovação por código", "Qualquer número que escrever recebe um código de pareamento e só fala com o bot depois de aprovado. Use só com número dedicado.", "text-amber-600")}
    </div>
  );
}
