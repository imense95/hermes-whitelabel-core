# Keycloak — provisionamento (set/2026)

Identity provider self-hosted da plataforma. Existe porque o dashboard do
Hermes, em bind não-loopback (obrigatório atrás do Traefik), **sempre exige um
auth provider registrado** — sem ele o processo dá `SystemExit` e não abre a
tela. Descoberto lendo `hermes_cli/web_server.py` (`should_require_auth`,
`_no_auth_provider_message`). O antigo `--insecure` foi desativado em jun/2026.

## O que já está no ar

- **Schema `keycloak` + role `keycloak_app`** no Postgres da plataforma
  (banco `plataforma`). Role nasce **sem senha** (não loga até humano definir),
  mesmo padrão da `urban_app`. Isolamento provado: `keycloak_app` vê 0 tabelas
  de `urban`/`platform`.
- **Serviço `keycloak`** criado no projeto `hermes-whitelabel`:
  - imagem `quay.io/keycloak/keycloak:26.7.4` (estável mais recente)
  - `command: start` (produção; **nunca `start-dev`** — banco em memória,
    perde tudo no restart). **NÃO usar `start --optimized`**: esse flag exige
    uma imagem pré-construída com `kc.sh build`; na imagem de estoque ele
    falha. `start` puro faz a auto-build no 1º boot.
  - banco: `KC_DB_URL=jdbc:postgresql://plataforma-db:5432/plataforma?currentSchema=keycloak`,
    user `keycloak_app`
  - atrás do Traefik: `KC_HOSTNAME=https://$(PRIMARY_DOMAIN)`,
    `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED=true`,
    `KC_HOSTNAME_STRICT=false`
  - `KC_HEALTH_ENABLED`/`KC_METRICS_ENABLED` ligados; `KC_CACHE=local` (nó único)
  - **NÃO deployado** — sobe com placeholder falharia.

## Por que os dois segredos ficam como placeholder (COLE_AQUI)

Keycloak 26 **não** suporta `_FILE` para segredos (issue keycloak#10816, aberto
desde 2022), e o EasyPanel **só** interpola `$(PROJECT_NAME)`, `$(SERVICE_NAME)`,
`$(PRIMARY_DOMAIN)` — não referencia segredo de outro serviço. Então a senha do
banco e a senha do admin **têm** que estar na env do Keycloak em texto. Se eu as
puser via API, voltam no retorno da chamada, para o contexto do agente — o mesmo
vazamento que evitei na `urban_app`. Por isso o humano preenche.

## Finalização (humano)

1. **PRÉ-REQUISITO — a role NASCE SEM SENHA.** O Keycloak não sobe enquanto a
   senha da role não existir no banco E for idêntica à do env. Rodar ANTES do
   deploy, num shell com `psql`:
   `ALTER ROLE keycloak_app WITH PASSWORD '<senha-forte>';`
   Conferir presença (nunca o valor):
   `select rolpassword is not null from pg_authid where rolname='keycloak_app';`
   → tem que dar `t`. Se der `f`, o boot falha com erro de auth no Postgres.
2. Serviço `keycloak` → Environment → trocar os dois `COLE_AQUI`:
   `KC_DB_PASSWORD` (= a de cima) e `KC_BOOTSTRAP_ADMIN_PASSWORD`.
3. Deploy do serviço `keycloak`. Primeiro boot cria as tabelas no schema e o
   admin inicial. Uma vez de pé, **remover** `KC_BOOTSTRAP_ADMIN_*` (só valem no
   1º boot; ficar guardado é risco à toa).
4. Verificar: `https://<dominio-keycloak>/health/ready` deve responder.

## Depois: ligar a Urban ao Keycloak

O client do Hermes é **público com PKCE** (`publicClient: true`,
`pkce.code.challenge.method: S256`) — o Hermes não suporta client confidencial.
Realm por cliente (`urban`). O provider de auth do dashboard é registrado por
plugin/config apontando para o realm; então o dashboard da Urban para de dar 502
e passa a exigir login OIDC. A chave do LLM entra pela própria tela depois disso.
