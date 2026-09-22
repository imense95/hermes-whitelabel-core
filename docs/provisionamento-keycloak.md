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

**ARMADILHA RESOLVIDA (set/2026): `password authentication failed for user
"keycloak_app"`.** O Keycloak buildava, subia o Quarkus e morria ao conectar no
Postgres — 4 bugs em sequência antes de achar a causa real:

1. `start --optimized` na imagem de estoque → falha (exige `kc.sh build` prévio).
2. `command` no EasyPanel é envolto em `/bin/sh -c`; `start` puro vira
   `/bin/sh -c start` e "start" não é executável. **Use o caminho completo:**
   `command: /opt/keycloak/bin/kc.sh start`.
3. A role nasce sem senha (ver acima).
4. **A senha do `KC_DB_PASSWORD` (env) e a do `ALTER ROLE` (banco) não batiam** —
   caractere especial mangleado entre o paste no painel e o `psql`. Diagnóstico
   só foi possível com SSH root + `docker logs` do container `Exited (1)` (o
   `service logs` do swarm trava; `getServiceError`/`queryServiceLogs` do painel
   não servem).

**Correção à prova de erro (com SSH root), sem a senha passar pelo contexto:**
ler o valor exato que o container do Keycloak recebeu e aplicá-lo na role:
```sh
kc=$(docker ps -a --filter name=hermes-whitelabel_keycloak --format '{{.ID}}' | head -1)
PW=$(docker inspect "$kc" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^KC_DB_PASSWORD=//p' | head -1)
pg=$(docker ps --filter name=hermes-whitelabel_plataforma-db --format '{{.ID}}' | head -1)
printf "ALTER ROLE keycloak_app WITH PASSWORD :'pw';\n" | \
  docker exec -i -e PGPASSWORD="$PGADMIN" "$pg" \
  psql -U plataforma_admin -d plataforma -v ON_ERROR_STOP=1 -v pw="$PW"
```
`:'pw'` só expande via stdin/arquivo, **não** com `psql -c`. As duas pontas ficam
idênticas por construção, qualquer que seja o caractere. Depois: redeploy.
Confirmado de pé: raiz HTTP 302, container `Up` além do minuto de crash.
`/health/ready` fica na porta de management 9000 (não na 8080 do domínio) → 404
no domínio público é esperado.

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

## Subida da Urban — ARMADILHAS RESOLVIDAS (set/2026, ordem de descoberta)

- **EasyPanel escopa volume por serviço:** `hermes-whitelabel_<svc>_dados`. Um
  serviço de diagnóstico com mount `dados` ganha um volume NOVO e vazio, não o da
  instância. Foi a causa de todo `.env` "perdido" — eu lia o volume errado; o
  `.env` real da Urban (`hermes-whitelabel_urban_dados`) estava intacto. Ler o
  volume certo por SSH: `docker run --rm -v hermes-whitelabel_urban_dados:/d ...`.
- **Escrever no `.env` por SSH quebra a dona:** `docker run alpine` roda como
  root; `mv`+`chmod` deixam `root:root` e o container (uid 10000) não lê →
  `PermissionError: /opt/data/.env`. Sempre `chown 10000:10000 && chmod 600` após
  mexer.
- **`command` no EasyPanel substitui o entrypoint** (envolve em `/bin/sh -c`). A
  imagem usa `entrypoint-dispatch.sh` → s6 → o dashboard é serviço s6 próprio
  (9119), `main-hermes` é `sleep infinity`, o CMD do usuário roda como "main
  program" do /init. Command vazio → CMD default = chat interativo → sai sem TTY
  → container para. `command: gateway run` → `/bin/sh -c gateway run` mata o s6.
  **Correto:** `command: exec /opt/hermes/docker/entrypoint-dispatch.sh sleep
  infinity` (o `exec` faz o dispatch virar PID 1 → s6 sobe → dashboard roda).
- **`updateAppDeploy` só persiste o command após `deployAppService`** — disparar
  o deploy logo em seguida.
- **Bug de imagem: venv-servicos apontava para `/root`.** `uv venv` sem
  `--python` usa o Python gerenciado do uv sob `/root` (modo 700); uid 10000 não
  atravessa → `exec: /opt/venv-servicos/bin/python: Permission denied` (Admin API
  não sobe). Corrigido: `uv venv --python /opt/hermes/.venv/bin/python`. **Exige
  REBUILD.**

**Circuito OIDC provado end-to-end:** `/auth/login?provider=self-hosted` com PKCE
devolve 302 para `…/realms/urban/protocol/openid-connect/auth?client_id=hermes-dashboard&redirect_uri=…/auth/callback&code_challenge_method=S256`.
Raiz da Urban = 302 → /login; container `Up` estável; dashboard READY na 9119.
Pendente: chave do LLM (`provider_configured=false`) entra pela tela após o login.
