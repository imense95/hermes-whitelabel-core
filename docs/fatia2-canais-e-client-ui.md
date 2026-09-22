# Fatia 2 — Canais (Telegram/WhatsApp) + servir o client-ui na origin

> Descoberta de reconhecimento (set/2026): **o upstream já traz os dois canais**
> como plugins de plataforma empacotados. A fatia 2 deixa de ser "construir os
> canais" e passa a ser **habilitar + fiar credencial + expor o QR + servir a
> SPA**. Tudo fork-free (plugin/config), coerente com a arquitetura do produto.

## O que já existe no core upstream (não reconstruir)

> **Atualização (reconhecimento 2):** o upstream NÃO só tem os adapters — tem a
> **API REST de onboarding de mensageria inteira** pronta
> (`hermes_cli/web_routers/messaging.py`, montada em `web_server.py`). Não
> precisamos escrever endpoint de QR nenhum. Rotas reais (mesma origin do
> dashboard, atrás do gate OIDC):
>
> - `POST /api/messaging/whatsapp/onboarding/start` → `{pairing_id, ...}`
> - `GET  /api/messaging/whatsapp/onboarding/{pairing_id}` →
>   `{status, qr_payload, account_phone, account_name, expires_at, error}`
>   (status: `starting` → `awaiting_qr`/`qr` → `connected`)
> - `POST /api/messaging/whatsapp/onboarding/{pairing_id}/apply` → grava
>   `WHATSAPP_ENABLED/MODE/ALLOWED_USERS` no `.env` do profile e reinicia o gateway
> - `DELETE /api/messaging/whatsapp/onboarding/{pairing_id}` → cancela
> - Telegram: mesmo padrão em `/api/messaging/telegram/onboarding/*`
> - `GET /api/messaging/platforms` → status/config de cada plataforma
> - `PUT /api/messaging/platforms/{id}` → enable/config
>
> O bridge Baileys é chamado internamente em `--pair-only --pair-json`; o
> `qr_payload` já vem serializado para o front desenhar. **Fatia 2 = alinhar o
> client-ui a essas rotas + servir a SPA + habilitar na Urban.** Nada de código
> novo no core.



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

## O QR já é exposto por REST no upstream (corrigido)

> **Nota (reconhecimento 2):** a suposição inicial de que precisaríamos escrever
> um endpoint de QR estava **errada**. O upstream já expõe QR + estado de
> pareamento por REST (`/api/messaging/whatsapp/onboarding/{id}` →
> `qr_payload`+`status`). O bridge é chamado internamente em `--pair-only
> --pair-json`. **Nenhum código novo no core.** O client-ui já foi alinhado a
> essas rotas (commit `e24585f`).

Telegram também tem onboarding por REST (deep-link + `qr_payload` + polling),
não exige token colado no front.

## Plano da fatia 2 (estado real)

1. **client-ui → endpoints reais dos canais** — ✅ **FEITO** (commits `a72379f`,
   `e24585f`). Abas ligadas a `/api/messaging/*`, QR renderizado, mock provado.
2. **Endpoint de QR do WhatsApp** — ✅ **já existia** no upstream, nada a escrever.
3. **Habilitar os plugins de plataforma na instância** (config, não código):
   `plugins.enabled` += telegram/whatsapp. **Reinicia o gateway.**
4. **Servir o client-ui na origin da Urban** — build `dist/` servido na mesma
   origin (cookie OIDC libera `/api/*`). **Pré-condição:** só é sem-restart se
   `HERMES_WEB_DIST` da instância apontar para caminho **gravável** em
   `/opt/data` (o `WEB_DIST` é lido por request, mas o env é lido no import e o
   default fica sob `/opt/hermes` read-only). A verificar no container.
5. **Provar ponta a ponta** na Urban: Telegram responde; QR do WhatsApp →
   parear número dedicado → mensagem entra/sai.

## Sequência de execução acordada (set/2026, com o idealizador)

Dividido em **duas janelas separadas**, por decisão do Herbert:

### Janela 1 — passo 4 isolado, sem restart, o agente executa sozinho
- Servir o `dist/` do client-ui na origin da Urban.
- Pré-condição confirmada: **não reinicia o gateway nem derruba sessão**.
- Ao terminar: capturar **prova** de que a SPA responde na origin da Urban e
  avisar o Herbert para confirmação visual. Só depois disso a janela 2 abre.

### Janela 2 — agrupar tudo que exige restart do gateway (agendada pelo Herbert)
Só entra quando o Herbert tiver **o número de WhatsApp dedicado em mãos** e um
**horário tranquilo** para reiniciar o serviço da Urban. Três coisas juntas:
- **Passo 3** — habilitar os plugins de Telegram e WhatsApp na instância.
- **Passo 5** — provar o fluxo ponta a ponta com credenciais reais.
- **Correção do `caption-writer.js`** — trocar o modelo descontinuado
  (`gemini-2.0-flash`) e limpar a sujeira do container (env vars
  `GEMINI_MODEL_TEXT`/`MARKETING_MOTOR_DIR`/`MARKETING_NODE`, `motor-patch/`,
  `bin/node-wrapper.sh`).

## Dependências do Herbert (regra de credencial)

- **Token do Telegram** (@BotFather) — via onboarding REST/tela; nunca no chat.
- **Número dedicado de WhatsApp** para parear (risco de ban assumido) — gate da
  janela 2.

## Pendências herdadas (dentro da janela 2)

- `caption-writer.js` hardcoded `gemini-2.0-flash` (descontinuado) → corrigir no
  repo do catálogo + rebuild; é o único passo do pipeline de marketing que falta.
- Limpar sujeira que o agente deixou no container Urban (env vars
  `GEMINI_MODEL_TEXT`/`MARKETING_MOTOR_DIR`/`MARKETING_NODE`, `motor-patch/`,
  `bin/node-wrapper.sh`).
