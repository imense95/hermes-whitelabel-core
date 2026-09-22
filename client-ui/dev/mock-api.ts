import type { Plugin } from "vite";

// Backend de MENTIRA para desenvolvimento visual (caminho A). Ativado só quando
// VITE_MOCK=1. Middleware do dev server — NÃO entra no build de produção.
// NOTA: /api/projects e /api/account NÃO existem no gateway real — foram
// removidos daqui para o mock não voltar a divergir do Hermes de produção.

const SESSIONS = [
  { session_id: "s_mkt", title: "Marketing — Urban Passageiro", group: "Hoje", updated_at: "2026-09-22T17:40:00Z", message_count: 12 },
  { session_id: "s_start", title: "Primeiros passos", group: "Hoje", updated_at: "2026-09-22T15:00:00Z", message_count: 6 },
  { session_id: "s_cfg", title: "Dúvidas de configuração", group: "Ontem", updated_at: "2026-09-21T14:05:00Z", message_count: 4 },
  { session_id: "s_report", title: "Relatório de analytics", group: "Ontem", updated_at: "2026-09-21T09:12:00Z", message_count: 8 },
  { session_id: "s_future", title: "O futuro da IA e seu impacto…", group: "Ontem", updated_at: "2026-09-21T08:00:00Z", message_count: 2 },
];

const MESSAGES: Record<string, { role: string; content: string }[]> = {
  s_mkt: [
    { role: "user", content: "vamos configurar o marketing" },
    { role: "assistant", content: "Ótimo! O onboarding já está em andamento — Drive conectado ✅. Próxima etapa: logo 🎨" },
    { role: "user", content: "esta é a logo horizontal preta" },
    { role: "assistant", content: "Recebi. Subi para o Drive em Hermes - Marketing/Identidade/. Agora me diga as cores da marca (pode mandar os hex ou os nomes)." },
  ],
  s_start: [
    { role: "assistant", content: "Bem-vindo ao seu painel Hermes 👋 Como posso ajudar hoje?" },
    { role: "user", content: "o que você consegue fazer?" },
    { role: "assistant", content: "Posso conversar, gerar conteúdo de marketing, conectar seus canais (Telegram, WhatsApp) e muito mais. É só pedir." },
  ],
  s_cfg: [{ role: "user", content: "como troco o modelo?" }, { role: "assistant", content: "Nas configurações (⚙), aba Modelos, você vê os modelos disponíveis nesta instância." }],
  s_report: [{ role: "assistant", content: "Aqui está o resumo do relatório de analytics da semana." }],
  s_future: [{ role: "assistant", content: "A IA está mudando rápido — aqui vão três tendências para ficar de olho." }],
};

const MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "google" },
];

// Estado de mensageria para o mock (simula onboarding real do upstream).
const SAMPLE_QR = "2@mockWhatsAppPairingPayload/ExemploParaDesenvolvimentoVisual==,AbCdEf123==,XyZ==";
const wa = { polls: 0, connected: false };
const tg = { polls: 0, connected: false };

function send(res: any, body: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function mockApi(): Plugin {
  return {
    name: "hermes-mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (!url.startsWith("/api") && !url.startsWith("/v1")) return next();

        // Espelha a forma REAL do gateway: listas embrulhadas em {object,data}.
        if (url === "/api/sessions") return send(res, { object: "list", data: SESSIONS });
        let mm = url.match(/^\/api\/sessions\/([^/]+)\/messages$/);
        if (mm) return send(res, { object: "list", session_id: decodeURIComponent(mm[1]), data: MESSAGES[decodeURIComponent(mm[1])] || [] });
        if (url === "/v1/models") return send(res, { object: "list", data: MODELS });
        if (url === "/api/model/options") return send(res, { options: MODELS });
        if (url === "/v1/health") return send(res, { status: "ok (mock)" });

        // --- Mensageria (rotas reais do upstream: /api/messaging/*) ---
        if (url === "/api/messaging/platforms") {
          return send(res, {
            whatsapp: { enabled: wa.connected, connected: wa.connected },
            telegram: { enabled: tg.connected, connected: tg.connected },
          });
        }
        // WhatsApp onboarding
        if (url === "/api/messaging/whatsapp/onboarding/start" && req.method === "POST") {
          wa.polls = 0; wa.connected = false;
          return send(res, { pairing_id: "wa_mock_1" });
        }
        let wm = url.match(/^\/api\/messaging\/whatsapp\/onboarding\/([^/]+)$/);
        if (wm) {
          wa.polls += 1;
          if (wa.polls >= 3) { wa.connected = true; return send(res, { pairing_id: wm[1], status: "connected", account_phone: "+55 65 99999-0000" }); }
          return send(res, { pairing_id: wm[1], status: "awaiting_qr", qr_payload: SAMPLE_QR });
        }
        if (/^\/api\/messaging\/whatsapp\/onboarding\/[^/]+\/apply$/.test(url) && req.method === "POST") {
          return send(res, { ok: true, needs_restart: false });
        }
        // Telegram onboarding
        if (url === "/api/messaging/telegram/onboarding/start" && req.method === "POST") {
          tg.polls = 0; tg.connected = false;
          return send(res, { pairing_id: "tg_mock_1", deep_link: "https://t.me/BotFather?start=mock", qr_payload: "https://t.me/BotFather?start=mock", suggested_username: "urban_bot" });
        }
        let tm = url.match(/^\/api\/messaging\/telegram\/onboarding\/([^/]+)$/);
        if (tm) {
          tg.polls += 1;
          if (tg.polls >= 3) { tg.connected = true; return send(res, { status: "connected", username: "@urban_bot" }); }
          return send(res, { status: "pending" });
        }
        if (/^\/api\/messaging\/telegram\/onboarding\/[^/]+\/apply$/.test(url) && req.method === "POST") {
          return send(res, { ok: true, needs_restart: false });
        }

        if (req.method === "POST" && url.endsWith("/chat")) {
          return send(res, {
            ok: true,
            reply: "Recebi sua mensagem. (resposta de exemplo do modo mock — sem backend real)",
          });
        }
        if (req.method === "POST") return send(res, { ok: true, mock: true });
        return send(res, { error: "mock: rota não mapeada", url }, 404);
      });
    },
  };
}
