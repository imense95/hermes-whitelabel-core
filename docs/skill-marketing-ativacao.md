# Skill de marketing — ativar numa instância

Estado: motor + plugin + skill assados na imagem `:staging` (build verde,
provado no host como uid 10000). Este doc é o checklist para LIGAR numa
instância — Urban primeiro.

## 1. App OAuth do Google (uma vez, da plataforma)

O cliente autoriza a própria conta Google; o app é nosso. Sem isso o
`conectar_drive` responde "MARKETING_GOOGLE_CLIENT_ID/_SECRET ausentes".

1. console.cloud.google.com → projeto novo (ex. `hermes-whitelabel`).
2. **APIs e serviços → Biblioteca** → ativar **Google Drive API**.
3. **Tela de consentimento OAuth** → tipo *Externo* → nome do app (o que o
   cliente vê: ex. "Hermes Marketing") → e-mail de suporte → salvar.
   Escopo: só `.../auth/drive.file` (não-sensível: **não exige auditoria**).
4. **Credenciais → Criar credenciais → ID do cliente OAuth** → tipo
   **"TVs e dispositivos de entrada limitada"** (é o que habilita o device
   flow). Anote `client_id` e `client_secret`.
5. Enquanto o app estiver em *Teste*: **Público-alvo → Usuários de teste** →
   adicionar o Gmail da Urban (e o seu). Em teste, o refresh token expira em
   7 dias — para produção, clicar **Publicar app** (sem auditoria, porque
   `drive.file` não é restrito).

`client_secret` vai só para o `.env` da instância (passo 2). Não cole no chat.

## 2. Variáveis no `.env` da instância

Já existem: `DATABASE_URL`, `API_SERVER_KEY`. Acrescentar (via
`POST /v1/credentials` da Admin API quando ela subir, ou pelo terminal do
serviço no EasyPanel — nunca sobrescrever o arquivo):

```
GEMINI_API_KEY=...                  # Nano Banana (imagem) + Gemini (prompts/legendas)
MARKETING_GOOGLE_CLIENT_ID=...
MARKETING_GOOGLE_CLIENT_SECRET=...
```

Depois: **Deploy** do serviço (o Hermes lê `/opt/data/.env` no boot).

## 3. Instalar plugin + skill (assessoria)

Pela Admin API (porta 8777, token da assessoria):

```
POST /v1/plugins/install {"plugin": "marketing"}       → copia + plugins.enabled no config.yaml
POST /v1/skills/install  {"skill": "marketing-conteudo"}
```

Ou à mão no volume, enquanto a Admin API não estiver exposta:
`cp -r /opt/product/plugins/marketing /opt/data/plugins/` (sem `motor/`),
`cp -r /opt/product/skills/marketing-conteudo /opt/data/skills/`, e em
`config.yaml`: `plugins: {enabled: [marketing]}`. Reiniciar o gateway.

Prova: no chat da Urban, "quais ferramentas de marketing você tem?" → deve
listar `marketing_config`, `marketing_calendario`, `marketing_post`.

## 4. Onboarding do zero (o teste combinado)

No chat da Urban: "vamos configurar o marketing". A skill chama
`marketing_config action=status`, vê `configurada=false` e conduz as 11
etapas (`references/onboarding.md`). O que preparar antes:
- logo em PNG/SVG; hex das cores (ou o nome — a skill converte e confirma);
- 3–10 prints de posts de referência;
- conta Google da Urban logada no celular para o passo do Drive
  (`google.com/device` + código de 8 letras).

Prova final: pasta `Hermes - Marketing/` no Drive da Urban com
`Identidade/`, `Referências/`, `Saídas/`; `status` → `configurada=true`.
Depois: uma entrada no calendário + `gerar` → `Saídas/<data>/` com 4 PNGs,
`legendas.md`, `resultado.json`.

## O que fica de fora da v1 (decidido)
Telegram para aprovação, publicação no Instagram, WhatsApp/Baileys, vídeo.
O código original está em `motor/agent/hermes/tools.original.js` para a v2.
