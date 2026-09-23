import { AlertTriangle, Check, Loader2, Power } from "lucide-react";
import type { PlatformInfo, ApplyResult } from "../lib/api";
import { stateLabel } from "../lib/usePlatform";

export function StatusBadge({ info }: { info: PlatformInfo | null }) {
  const s = stateLabel(info);
  const cls = {
    ok: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
    warn: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    off: "bg-background-100 text-text-50",
    err: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  }[s.tone];
  return (
    <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
      {s.tone === "ok" ? <Check size={13} /> : s.tone === "warn" ? <Loader2 size={13} className="animate-spin" /> : s.tone === "err" ? <AlertTriangle size={13} /> : <Power size={13} />}
      {s.text}
    </span>
  );
}

/** Resultado do apply: reinício disparado ou não. Nunca silencioso. */
export function ApplyNotice({ r }: { r: ApplyResult | null }) {
  if (!r) return null;
  if (r.restart_started) {
    return <p className="rounded-md bg-primary-light px-4 py-3 text-xs text-primary">Configuração salva. O serviço está reiniciando — o status acima atualiza sozinho em alguns segundos.</p>;
  }
  return (
    <p className="rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
      Configuração salva, mas o serviço <b>não reiniciou sozinho</b>{r.restart_error ? ` (${r.restart_error})` : ""}. Peça à equipe para reiniciar a instância; o canal fica "Aguardando reinício" até lá.
    </p>
  );
}

export function ErrorNotice({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return <p className="rounded-md bg-red-50 px-4 py-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{msg}</p>;
}
