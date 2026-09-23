import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PlatformInfo } from "./api";

// Estado REAL de um canal, lido de GET /api/messaging/platforms. É a fonte de
// verdade das abas: o que aconteceu na sessão anterior do navegador não conta.
// Enquanto o gateway reinicia (após um apply), o estado fica "pending_restart"
// ou o gateway some — o hook faz polling até estabilizar.
export function usePlatform(id: "telegram" | "whatsapp") {
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.messagingPlatforms();
      const p = (r?.platforms || []).find((x) => x.id === id) || null;
      setInfo(p);
      setError(null);
      return p;
    } catch (e: any) {
      setError(e?.message || "falha ao ler o estado do canal");
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  /** Após um apply: poll até o canal sair de pending_restart / gateway parado (máx ~90 s). */
  const watchUntilSettled = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    let n = 0;
    pollRef.current = setInterval(async () => {
      n += 1;
      const p = await refresh();
      const transient = !p || !p.gateway_running || p.state === "pending_restart" || p.state === "connecting" || p.state === "retrying";
      if (!transient || n >= 30) { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; }
    }, 3000);
  }, [refresh]);

  return { info, loading, error, refresh, watchUntilSettled };
}

export function stateLabel(p: PlatformInfo | null): { text: string; tone: "ok" | "warn" | "off" | "err" } {
  if (!p) return { text: "—", tone: "off" };
  if (!p.enabled) return { text: "Desligado", tone: "off" };
  switch (p.state) {
    case "connected": return { text: "Ativo", tone: "ok" };
    case "pending_restart": return { text: "Aguardando reinício", tone: "warn" };
    case "connecting": case "retrying": return { text: "Conectando…", tone: "warn" };
    case "not_configured": return { text: "Não configurado", tone: "off" };
    case "gateway_stopped": return { text: "Serviço parado", tone: "warn" };
    case "startup_failed": case "error": case "fatal": return { text: "Erro", tone: "err" };
    default: return { text: p.state || "—", tone: "warn" };
  }
}
