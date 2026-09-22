import { useState } from "react";

// Conexão do WhatsApp por QR Code (motor Baileys — decisão do cliente, ciente do
// risco de ban por ser não-oficial). O motor Node roda ISOLADO no container e
// emite o QR; este painel faz polling do QR e do status de pareamento.
// NOTA: endpoints (GET /api/channels/whatsapp/qr, /status) são da fatia 2.
export function WhatsAppTab() {
  const [state, setState] = useState<"idle" | "loading" | "backend-missing">("idle");

  async function startPairing() {
    setState("loading");
    // fatia 2: const { qr } = await api.whatsappQr(); depois polling de status
    setTimeout(() => setState("backend-missing"), 400);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="tg-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366]/10 text-[#25D366]">
            ⬤
          </span>
          <div>
            <h2 className="text-base font-semibold text-dark">WhatsApp</h2>
            <p className="text-sm text-body">Pareie escaneando um QR Code.</p>
          </div>
        </div>

        <div className="mt-5 flex flex-col items-center">
          <div className="flex h-56 w-56 items-center justify-center rounded-lg border-2 border-dashed border-stroke bg-surface">
            {state === "loading" ? (
              <span className="text-sm text-body">Gerando QR…</span>
            ) : (
              <span className="px-6 text-center text-xs text-body">
                O QR Code aparece aqui após iniciar o pareamento.
              </span>
            )}
          </div>
          <button className="tg-btn mt-5 w-full" disabled={state === "loading"} onClick={startPairing}>
            Iniciar pareamento
          </button>
        </div>

        <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-700">
          <b>Atenção:</b> conexão não-oficial (Baileys). Use um número dedicado —
          há risco de bloqueio pela Meta. O endpoint que emite o QR entra na
          próxima fatia.
        </p>

        {state === "backend-missing" && (
          <p className="mt-2 text-xs text-body">
            UI pronta; falta ligar o motor Baileys isolado (fatia 2).
          </p>
        )}
      </div>
    </div>
  );
}
