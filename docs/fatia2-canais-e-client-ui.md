# Fatia 2 — Canais (Telegram/WhatsApp) + servir o client-ui na origin

> Descoberta de reconhecimento (set/2026): **o upstream já traz os dois canais**
> como plugins de plataforma empacotados. A fatia 2 deixa de ser "construir os
> canais" e passa a ser **habilitar + fiar credencial + expor o QR + servir a
> SPA**. Tudo fork-free (plugin/config), coerente com a arquitetura do produto.

## O que já existe no core upstream (não reconstruir)

- **`plugins/platforms/telegram/`** — adapter nativo via `python-telegram-bot`.
  - Credencial: `TELEGRAM_BOT_TOKEN` (do @BotFather). Opcionais:
    `TELEGRAM_ALLOWED_USERS`, `TELEGRAM_HOME_CHANNEL`.
  - **Teclado inline** já suportado (`inline_picker.py`) = par do nosso
    `ChoiceCards` no Telegram.
- **`plugins/platforms/whatsapp/`** — adapter + **bridge Baileys**
  (`scripts/whatsapp-bridge/bridge.js`, `@whiskeysockets/baileys`).
  - **Processo Node separado**, API HTTP em `127.0.0.1:<porta>` — exatamente o
    isolamento que o Herbert exigiu (ban/crash do WhatsApp não derruba o agente).
    O adapter já gerencia ciclo de vida do bridge (pidfile, mata órfão, health).
  - Endpoints do bridge: `/send`, `/send-media`, `/send-location`, **`/send-poll`**
    (enquete do WhatsApp = par do `ChoiceCards`), `/health`.
  - QR: o bridge emite `emitPairEvent({event:'qr', qr})` e imprime no terminal
    (`qrcode-terminal`). Credencial: `WHATSAPP_ENABLED=true` + parear pelo QR.

## O único trecho que NÃO existe upstream (é o nosso trabalho de código)

O QR do WhatsApp e o estado de pareamento **não são expostos por REST** — hoje
saem no log/terminal e o pareamento de usuário é por código no DM do dono. Para
a aba de WhatsApp do client-ui mostrar o QR, precisamos de **um endpoint novo**
(no core, atrás do gate OIDC) que:
1. dispare o start do bridge (se não estiver rodando);
2. faça proxy do último `qr` emitido (e do estado: `aguardando_qr` →
   `conectado`), lendo o pair-event/health do bridge.

Telegram não precisa de QR — só do token; a "conexão" é o bot passar a responder.

## Plano da fatia 2 (ordem proposta)

1. **client-ui → endpoints reais dos canais** (sem risco; app separado):
   - `GET /api/channels` (status de cada canal: conectado?/pendente),
   - `POST /api/channels/telegram` (grava token via Admin API `/v1/credentials`,
     allowlist já tem que incluir `TELEGRAM_BOT_TOKEN`),
   - `GET /api/channels/whatsapp/qr` (novo endpoint de QR acima),
   - mock correspondente para o caminho A continuar funcionando.
2. **Endpoint de QR do WhatsApp** no core (o trecho novo acima) + teste.
3. **Habilitar os plugins de plataforma na imagem/instância** (config, não código):
   `plugins.enabled` += telegram/whatsapp; bridge Node já vem na imagem upstream.
4. **Servir o client-ui na origin da Urban** — build `dist/` servido pelo mesmo
   gateway (cookie OIDC do Keycloak libera `/api/*`), rota tipo `/app`.
5. **Provar ponta a ponta** na Urban: token do Telegram (Herbert cadastra) → bot
   responde; QR do WhatsApp → parear número dedicado → mensagem entra/sai.

## Dependências do Herbert (regra de credencial)

- **Token do Telegram** (@BotFather) — Herbert cadastra pela tela; nunca no chat.
- **Número dedicado de WhatsApp** para parear (risco de ban assumido).
- Habilitar canais **reinicia o gateway** → derruba a sessão do profile
  `marketing` momentaneamente (aceitável, reconecta).

## Pendências herdadas (antes de "fatia 2 pronta")

- `caption-writer.js` hardcoded `gemini-2.0-flash` (descontinuado) → corrigir no
  repo do catálogo + rebuild; é o único passo do pipeline de marketing que falta.
- Limpar sujeira que o agente deixou no container Urban (env vars
  `GEMINI_MODEL_TEXT`/`MARKETING_MOTOR_DIR`/`MARKETING_NODE`, `motor-patch/`,
  `bin/node-wrapper.sh`) — requer restart do gateway (casa com o restart do item 3).
