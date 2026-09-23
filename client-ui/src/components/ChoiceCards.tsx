import { useState } from "react";

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * Escolha visual no chat web — o equivalente à enquete do WhatsApp e ao botão
 * inline do Telegram. Usado pelos cartões de APROVAÇÃO (o agente quer rodar um
 * comando sensível: once/session/always/deny) e de CLARIFY (o agente faz uma
 * pergunta com opções). Ambos chegam como pedido servidor->cliente pelo WS e
 * são respondidos com o mesmo id (lib/gateway.ts::answer).
 */
export function ChoiceCards({
  prompt,
  detail,
  options,
  onChoose,
  disabled,
  tone = "primary",
}: {
  prompt: string;
  detail?: string;
  options: ChoiceOption[];
  onChoose: (id: string) => void | Promise<void>;
  disabled?: boolean;
  tone?: "primary" | "warning";
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(id: string) {
    if (busy || disabled) return;
    setPicked(id);
    setBusy(true);
    try {
      await onChoose(id);
    } finally {
      setBusy(false);
    }
  }

  const border = tone === "warning" ? "border-l-amber-500" : "border-l-primary";

  return (
    <div className={`rounded-xl border border-stroke bg-panel p-4 shadow-panel border-l-4 ${border}`}>
      <p className="mb-1 break-words text-sm font-medium text-title">{prompt}</p>
      {detail && (
        <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background-50 px-3 py-2 font-mono text-xs text-text-200">{detail}</pre>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((opt) => {
          const active = picked === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled || busy}
              onClick={() => choose(opt.id)}
              className={[
                "flex flex-col items-start rounded-md border p-3 text-left transition",
                active
                  ? "border-primary bg-primary-light ring-1 ring-primary"
                  : "border-stroke bg-panel hover:border-primary hover:bg-primary-light/40",
                disabled || busy ? "cursor-not-allowed opacity-70" : "",
              ].join(" ")}
            >
              <span className="text-sm font-semibold text-title">{opt.label}</span>
              {opt.description && <span className="mt-1 text-xs text-text-50">{opt.description}</span>}
            </button>
          );
        })}
      </div>
      {busy && <p className="mt-3 text-xs text-text-50">Enviando escolha…</p>}
    </div>
  );
}
