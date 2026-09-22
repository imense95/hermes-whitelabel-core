import type { Plugin } from "vite";

// Backend de MENTIRA para desenvolvimento visual (caminho A). Ativado só quando
// VITE_MOCK=1. Roda como middleware do dev server do Vite — NÃO entra no build
// de produção. Devolve dados de exemplo para as abas Sessões e Tokens verem o
// visual funcionando sem token, sem OIDC e sem instância real.

const SESSIONS = [
  {
    session_id: "20260922_marketing_urban",
    title: "Marketing — Urban Passageiro",
    updated_at: "2026-09-22T17:40:00Z",
    message_count: 12,
  },
  {
    session_id: "20260922_suporte",
    title: "Dúvidas de configuração",
    updated_at: "2026-09-22T14:05:00Z",
    message_count: 4,
  },
  {
    session_id: "20260921_boasvindas",
    title: "Primeira conversa",
    updated_at: "2026-09-21T09:12:00Z",
    message_count: 2,
  },
];

const MESSAGES: Record<string, { role: string; content: string }[]> = {
  "20260922_marketing_urban": [
    { role: "user", content: "vamos configurar o marketing" },
    { role: "assistant", content: "Ótimo! O onboarding já está em andamento — Drive conectado ✅. Próxima etapa: logo 🎨" },
    { role: "user", content: "esta é a logo horizontal preta" },
    { role: "assistant", content: "Recebi. Subi para o Drive em Hermes - Marketing/Identidade/. Agora me diga as cores da marca." },
  ],
  "20260922_suporte": [
    { role: "user", content: "como troco o modelo?" },
    { role: "assistant", content: "Na aba Tokens você vê os modelos configurados nesta instância." },
  ],
  "20260921_boasvindas": [
    { role: "assistant", content: "Bem-vindo ao seu painel Hermes 👋" },
  ],
};

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "google" },
];

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

        if (url === "/api/sessions") return send(res, SESSIONS);
        const m = url.match(/^\/api\/sessions\/([^/]+)\/messages$/);
        if (m) return send(res, MESSAGES[decodeURIComponent(m[1])] || []);
        if (url === "/v1/models") return send(res, MODELS);
        if (url === "/api/model/options") return send(res, { options: MODELS });
        if (url === "/v1/health") return send(res, { status: "ok (mock)" });

        // POSTs de escrita: só confirmam, para a UI não quebrar no clique.
        if (req.method === "POST") return send(res, { ok: true, mock: true });
        return send(res, { error: "mock: rota não mapeada", url }, 404);
      });
    },
  };
}
