// Backend de MENTIRA para desenvolvimento visual (caminho A). Ativado só quando
// VITE_MOCK=1. Middleware do dev server — NÃO entra no build de produção.
var PROJECTS = [
    { id: "pimjo", name: "Pimjo", count: 3 },
    { id: "meku", name: "Meku", count: 2 },
    { id: "formbold", name: "Formbold", count: 4 },
    { id: "urban", name: "Urban Passageiro", count: 3 },
];
var SESSIONS = [
    { session_id: "s_mkt", title: "Marketing — Urban Passageiro", group: "Hoje", updated_at: "2026-09-22T17:40:00Z", message_count: 12 },
    { session_id: "s_start", title: "Primeiros passos", group: "Hoje", updated_at: "2026-09-22T15:00:00Z", message_count: 6 },
    { session_id: "s_cfg", title: "Dúvidas de configuração", group: "Ontem", updated_at: "2026-09-21T14:05:00Z", message_count: 4 },
    { session_id: "s_report", title: "Relatório de analytics", group: "Ontem", updated_at: "2026-09-21T09:12:00Z", message_count: 8 },
    { session_id: "s_future", title: "O futuro da IA e seu impacto…", group: "Ontem", updated_at: "2026-09-21T08:00:00Z", message_count: 2 },
];
var MESSAGES = {
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
var MODELS = [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "google" },
];
var ACCOUNT = { name: "Cliente Urban", email: "contato@urbanpassageiro.com.br", plan: "Ativo" };
function send(res, body, status) {
    if (status === void 0) { status = 200; }
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
}
export function mockApi() {
    return {
        name: "hermes-mock-api",
        configureServer: function (server) {
            server.middlewares.use(function (req, res, next) {
                var url = (req.url || "").split("?")[0];
                if (!url.startsWith("/api") && !url.startsWith("/v1"))
                    return next();
                if (url === "/api/sessions")
                    return send(res, SESSIONS);
                if (url === "/api/projects")
                    return send(res, PROJECTS);
                if (url === "/api/account")
                    return send(res, ACCOUNT);
                var m = url.match(/^\/api\/sessions\/([^/]+)\/messages$/);
                if (m)
                    return send(res, MESSAGES[decodeURIComponent(m[1])] || []);
                if (url === "/v1/models")
                    return send(res, MODELS);
                if (url === "/api/model/options")
                    return send(res, { options: MODELS });
                if (url === "/v1/health")
                    return send(res, { status: "ok (mock)" });
                if (req.method === "POST" && url.endsWith("/chat")) {
                    return send(res, {
                        ok: true,
                        reply: "Recebi sua mensagem. (resposta de exemplo do modo mock — sem backend real)",
                    });
                }
                if (req.method === "POST")
                    return send(res, { ok: true, mock: true });
                return send(res, { error: "mock: rota não mapeada", url: url }, 404);
            });
        },
    };
}
