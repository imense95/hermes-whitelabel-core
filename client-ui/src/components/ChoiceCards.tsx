import { useState } from "react";

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * Escolha visual no chat web — o equivalente à enquete do WhatsApp e ao botão
 * inline do Telegram, mas renderizado como cartões clicáveis em vez de "digite
 * a opção". A skill emite um bloco de escolha; este componente o desenha e
 * devolve o id selecionado (o chamador faz api.answerApproval).
 *
 * A MESMA escolha é adaptada por canal na camada de gateway:
 *   - WhatsApp  -> enquete (poll)
 *   - Telegram  -> botões inline
 *   - Web       -> este componente
 */
export function ChoiceCards({
  prompt,
  options,
  onChoose,
  disabled,
}: {
  prompt: string;
  options: ChoiceOption[];
  onChoose: (id: string) => void | Promise<void>;
  disabled?: boolean;
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

  return (
    <div className="tg-card border-l-4 border-l-primary">
      <p className="mb-4 text-sm font-medium text-dark">{prompt}</p>
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
                "flex flex-col items-start rounded-md border p-4 text-left transition",
                active
                  ? "border-primary bg-primary-light ring-1 ring-primary"
                  : "border-stroke bg-panel hover:border-primary hover:bg-primary-light/40",
                disabled || busy ? "cursor-not-allowed opacity-70" : "",
              ].join(" ")}
            >
              <span className="text-sm font-semibold text-dark">{opt.label}</span>
              {opt.description && (
                <span className="mt-1 text-xs text-body">{opt.description}</span>
              )}
            </button>
          );
        })}
      </div>
      {busy && <p className="mt-3 text-xs text-body">Enviando escolha…</p>}
    </div>
  );
}
