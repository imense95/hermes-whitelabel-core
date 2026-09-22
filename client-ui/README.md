# client-ui — Painel do cliente final (white-label)

App React separado do dashboard de desenvolvimento. Mesma instância, mesmo
backend (gateway do Hermes). Fatia 1.

## Rodar em dev (contra uma instância real)

```bash
cd client-ui
npm install
# aponte para o gateway e (em loopback) passe o session-token do dashboard:
export VITE_GATEWAY_URL=http://127.0.0.1:8642
export VITE_SESSION_TOKEN=<HERMES_DASHBOARD_SESSION_TOKEN da instância>
npm run dev        # http://localhost:5174
```

O Vite faz proxy de `/api` e `/v1` para o gateway e injeta o header
`X-Hermes-Session`. Assim a aba **Sessões** lista conversas reais e **Tokens**
lista os modelos configurados.

## Produção (mesma origin do gateway)

Atrás do OIDC do Keycloak, o `/api/*` do gateway é liberado por **cookie de
sessão** (não por token no header). Logo, o front deve ser servido no **mesmo
host** e atrás do **mesmo gate** do dashboard — o cookie flui sozinho. Sirva o
conteúdo de `dist/` (após `npm run build`) por um caminho da mesma origin
(ex.: `/app/`). Variáveis opcionais para login explícito standalone:

```
VITE_OIDC_ISSUER=https://<keycloak>/realms/<cliente>
VITE_OIDC_CLIENT_ID=hermes-client-ui
```

## Abas (fatia 1)

| Aba | Backend |
|-----|---------|
| Sessões | `/api/sessions`, `/api/sessions/{id}/messages` — **ligado** |
| Tokens | `/v1/models` — **ligado** (a chave entra pelo env da instância, nunca aqui) |
| Telegram | bot token (@BotFather) — UI pronta; endpoint = fatia 2 |
| WhatsApp | QR/Baileys — UI pronta; motor isolado + endpoint = fatia 2 |
| Escolha visual | `ChoiceCards` → `/v1/runs/{id}/approval` |

## Fatia 2 (próxima)

- Endpoint de provisionamento do bot Telegram.
- **Motor WhatsApp (Baileys) como serviço/plugin ISOLADO** — fora do processo do
  agente, para um ban/crash não derrubar a instância. Emite o QR; o painel faz
  polling de `/api/channels/whatsapp/qr` e `/status`.
- Streaming de chat (SSE) na aba Sessões.
