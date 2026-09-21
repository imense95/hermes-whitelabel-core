#!/usr/bin/env bash
# scripts/onboard-client.sh <slug> "<Nome>"
#
# Onboarding de um cliente, fim a fim. Idempotente: rodar de novo nao
# regenera segredo, nao duplica registro, nao derruba container saudavel.
#
# Pre-requisitos no ambiente:
#   EASYPANEL_API_KEY   chave do usuario hermes-provisionamento (SO durante
#                       o onboarding; tire do ambiente depois)
#   PG_SUPERUSER_PASSWORD
#   KEYCLOAK_ADMIN_PASSWORD
#   BASE_DOMAIN
#
# Se qualquer passo falhar, o tenant fica em 'provisionando' e NADA e'
# desfeito. Provisionamento parcial visivel e consertavel e' melhor que
# rollback automatico apagando dado de cliente.
set -euo pipefail

SLUG="${1:?uso: onboard-client.sh <slug> \"<Nome>\"}"
NOME="${2:-$SLUG}"

[[ "$SLUG" =~ ^[a-z][a-z0-9_]{1,30}$ ]] || {
  echo "slug invalido: [a-z][a-z0-9_], 2-31 chars (vira schema, role, realm e subdominio)" >&2
  exit 1
}

: "${BASE_DOMAIN:?defina BASE_DOMAIN}"
: "${EASYPANEL_API_KEY:?defina EASYPANEL_API_KEY (usuario de provisionamento)}"

COFRE="${COFRE_DIR:-$HOME/.hermes-whitelabel/cofre}/${SLUG}"
mkdir -p "$COFRE" && chmod 700 "$COFRE"

ep() { easypanel --format json "$@"; }

passo() { printf '\n\033[1m[%s/6] %s\033[0m\n' "$1" "$2"; }

# --- segredo idempotente: gera uma vez, reusa sempre ----------------------
segredo() {
  local arquivo="$COFRE/$1"
  if [[ ! -f "$arquivo" ]]; then
    (umask 077; openssl rand -base64 32 | tr -d '/+=' | head -c 32 > "$arquivo")
  fi
  cat "$arquivo"
}

PG_PASS="$(segredo pg-role.secret)"
ADMIN_TOKEN="$(segredo admin-api.token)"
ADMIN_TOKEN_HASH="$(printf '%s' "$ADMIN_TOKEN" | sha256sum | cut -d' ' -f1)"

# =========================================================================
passo 1 "registrando em platform.tenants"
# =========================================================================
psql_platform() {
  ep service postgres exec plataforma/postgres -- \
    psql -v ON_ERROR_STOP=1 -U platform -d app "$@"
}

psql_platform -c "
  INSERT INTO platform.tenants (slug, nome, schema_name, db_role, status)
  VALUES ('${SLUG}', '${NOME}', '${SLUG}', '${SLUG}_app', 'provisionando')
  ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now();"

# =========================================================================
passo 2 "criando role e schema isolados no Postgres"
# =========================================================================
psql_platform <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${SLUG}_app') THEN
    CREATE ROLE ${SLUG}_app LOGIN;
  END IF;
END
\$\$;
ALTER ROLE ${SLUG}_app WITH PASSWORD '${PG_PASS}';
ALTER ROLE ${SLUG}_app SET search_path = ${SLUG};
ALTER ROLE ${SLUG}_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE SCHEMA IF NOT EXISTS ${SLUG} AUTHORIZATION ${SLUG}_app;
GRANT CONNECT ON DATABASE app TO ${SLUG}_app;
REVOKE ALL ON SCHEMA public   FROM ${SLUG}_app;
REVOKE ALL ON SCHEMA platform FROM ${SLUG}_app;
SQL

# =========================================================================
passo 3 "criando realm e client no Keycloak"
# =========================================================================
KC="https://auth.${BASE_DOMAIN}"
KC_TOKEN="$(curl -fsS -X POST "${KC}/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli -d username=admin \
  --data-urlencode "password=${KEYCLOAK_ADMIN_PASSWORD:?defina KEYCLOAK_ADMIN_PASSWORD}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')"

kc_api() { curl -fsS -H "Authorization: Bearer ${KC_TOKEN}" -H 'Content-Type: application/json' "$@"; }

if ! kc_api "${KC}/admin/realms/${SLUG}" >/dev/null 2>&1; then
  kc_api -X POST "${KC}/admin/realms" \
    -d "{\"realm\":\"${SLUG}\",\"enabled\":true,\"displayName\":\"${NOME}\"}"
  echo "  realm ${SLUG} criado"
else
  echo "  realm ${SLUG} ja existia"
fi

# Client PUBLICO com PKCE: o Hermes nao suporta client confidencial.
if ! kc_api "${KC}/admin/realms/${SLUG}/clients?clientId=hermes-dashboard" | grep -q hermes-dashboard; then
  kc_api -X POST "${KC}/admin/realms/${SLUG}/clients" -d "{
    \"clientId\": \"hermes-dashboard\",
    \"enabled\": true,
    \"publicClient\": true,
    \"standardFlowEnabled\": true,
    \"protocol\": \"openid-connect\",
    \"redirectUris\": [\"https://${SLUG}.${BASE_DOMAIN}/auth/callback\"],
    \"webOrigins\": [\"https://${SLUG}.${BASE_DOMAIN}\"],
    \"attributes\": {\"pkce.code.challenge.method\": \"S256\"}
  }"
  echo "  client hermes-dashboard criado"
else
  echo "  client hermes-dashboard ja existia"
fi

# =========================================================================
passo 4 "criando o servico no EasyPanel"
# =========================================================================
# Segredos vao como env do servico. A chave do LLM NAO entra aqui: e' do
# cliente e chega pela Admin API no passo de entrega.
if ! ep project inspect "cliente-${SLUG}" >/dev/null 2>&1; then
  ep project create --name "cliente-${SLUG}"
fi

ep service app create "cliente-${SLUG}/hermes" \
  --source-type image \
  --image "ghcr.io/${GITHUB_ORG:?defina GITHUB_ORG}/hermes-whitelabel:${PRODUCT_TAG:-stable}" \
  --env "TENANT_SLUG=${SLUG}
DATABASE_URL=postgresql://${SLUG}_app:${PG_PASS}@postgres:5432/app?options=-csearch_path%3D${SLUG}
ADMIN_AUDIT_DSN=postgresql://platform_admin_tool:${ADMIN_AUDIT_PASS:?defina ADMIN_AUDIT_PASS}@postgres:5432/app
ADMIN_API_TOKEN_SHA256=${ADMIN_TOKEN_HASH}
ADMIN_AUDIT_MODE=db
HERMES_DASHBOARD=1
HERMES_DASHBOARD_HOST=0.0.0.0
HERMES_DASHBOARD_OIDC_ISSUER=${KC}/realms/${SLUG}
HERMES_DASHBOARD_OIDC_CLIENT_ID=hermes-dashboard" \
  2>/dev/null || echo "  servico ja existia; atualize pelo painel se precisar"

ep service app domain add "cliente-${SLUG}/hermes" \
  --host "${SLUG}.${BASE_DOMAIN}" --port 9119 --https 2>/dev/null || true
ep service app domain add "cliente-${SLUG}/hermes" \
  --host "admin-${SLUG}.${BASE_DOMAIN}" --port 8777 --https 2>/dev/null || true

ep service app deploy "cliente-${SLUG}/hermes"

# =========================================================================
passo 5 "aguardando a instancia ficar saudavel"
# =========================================================================
SAUDAVEL=0
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://admin-${SLUG}.${BASE_DOMAIN}/health" >/dev/null 2>&1; then
    SAUDAVEL=1; break
  fi
  sleep 5
done

if [[ "$SAUDAVEL" != "1" ]]; then
  echo "
  A instancia nao respondeu em 5 minutos. O tenant fica em 'provisionando'.
  Nada foi desfeito — investigue os logs no EasyPanel e rode este script de
  novo quando resolver." >&2
  exit 1
fi

# =========================================================================
passo 6 "aplicando migracoes e ativando"
# =========================================================================
"$(dirname "$0")/../infra/scripts/migrate.sh" "${SLUG}"
psql_platform -c "UPDATE platform.tenants SET status='ativo', atualizado_em=now() WHERE slug='${SLUG}';"

cat <<EOF

=========================================================================
 ${NOME} (${SLUG}) provisionado
=========================================================================
  dashboard  https://${SLUG}.${BASE_DOMAIN}       (login pelo Keycloak)
  admin API  https://admin-${SLUG}.${BASE_DOMAIN} (bearer token)
  schema     ${SLUG}   role ${SLUG}_app
  realm      ${SLUG}   client hermes-dashboard (publico + PKCE)

  Segredos em ${COFRE} — mova para o cofre da equipe e apague daqui.

 FALTA para a instancia funcionar: gravar a chave de LLM do cliente.
 A instancia sobe, autentica e nao responde nada ate isso acontecer.

   curl -X POST https://admin-${SLUG}.${BASE_DOMAIN}/v1/credentials \\
     -H "Authorization: Bearer \$(cat ${COFRE}/admin-api.token)" \\
     -H "X-Operador: seu.nome@assessoria" \\
     -H "Content-Type: application/json" \\
     -d '{"credenciais": {"OPENROUTER_API_KEY": "sk-or-..."}}'

 Depois: reinicie pelo EasyPanel e confira
   GET https://admin-${SLUG}.${BASE_DOMAIN}/v1/status  ->  pronta_para_uso

 E tire EASYPANEL_API_KEY do ambiente — era a chave de provisionamento.
EOF
