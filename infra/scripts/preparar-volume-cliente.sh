#!/bin/sh
# infra/scripts/preparar-volume-cliente.sh
# Fase de preparo do volume de um cliente, ANTES do primeiro boot do Hermes.
# Roda numa imagem postgres:16 (openssl, psql, sh) com o volume do cliente
# montado em /opt/data e PGPASSWORD do admin da plataforma no ambiente.
#
# Regras:
#   - toda credencial nasce AQUI e vai direto ao arquivo; NENHUMA e' impressa
#     (o log do painel e' legivel pelo agente, e o objetivo e' que nem ele
#     conheca esses valores)
#   - idempotente: chave que ja existe no .env NAO e' regenerada, entao rodar
#     de novo nao invalida sessao nem credencial de ninguem
#   - so NOMES de chave saem no relatorio
#
# Variaveis: SLUG (ex.: urban). O resto e' derivado.
#
# Depois do preparo, o servico do cliente volta para a imagem do produto com
# command VAZIO: o ENTRYPOINT oficial (/opt/hermes/docker/entrypoint-dispatch.sh)
# sobe o s6, que dropa para UID 10000 e le /opt/data/.env sozinho
# (HERMES_HOME=/opt/data e' ENV da imagem). Nao ha wrapper de start: um
# `exec hermes gateway run` como root pularia o s6 e a Admin API nao subiria.
set -u
: "${SLUG:?defina SLUG}"
ROLE="${SLUG}_app"
ENV=/opt/data/.env
export PGHOST="${PGHOST:-plataforma-db}" PGUSER="${PGUSER:-plataforma_admin}" PGDATABASE="${PGDATABASE:-plataforma}"
for i in $(seq 1 15); do pg_isready -q && break; sleep 3; done

umask 077
mkdir -p /opt/data
touch "$ENV"
tem() { grep -q "^$1=" "$ENV"; }
poe() { printf '%s=%s\n' "$1" "$2" >> "$ENV"; }
rnd() { openssl rand -base64 48 | tr -d '/+=\n' | head -c "$1"; }

# --- 1. senha da role do cliente + DATABASE_URL -----------------------------
STATUS_DB=preservado
if ! tem DATABASE_URL; then
  SENHA=$(rnd 40)
  psql -v ON_ERROR_STOP=1 -q -v senha="$SENHA" -v role="$ROLE" <<'SQL' || { echo FALHA-alter-role; exit 1; }
\set q :'senha'
ALTER ROLE :role WITH PASSWORD :q;
SQL
  # prova: loga como a role com a senha nova, e o search_path esta travado
  CU=$(PGPASSWORD="$SENHA" psql -U "$ROLE" -Atc 'select current_user' 2>/dev/null)
  [ "$CU" = "$ROLE" ] || { echo FALHA-login-role; exit 1; }
  SP=$(PGPASSWORD="$SENHA" psql -U "$ROLE" -Atc 'show search_path' 2>/dev/null)
  [ "$SP" = "$SLUG" ] || { echo "FALHA-search_path=$SP"; exit 1; }
  poe DATABASE_URL "postgresql://${ROLE}:${SENHA}@${PGHOST}:5432/${PGDATABASE}?options=-csearch_path%3D${SLUG}"
  unset SENHA
  STATUS_DB=gerado
fi

# --- 2. auditoria: funcao em producao + prova logado como a role ------------
AUD=ok
psql -v ON_ERROR_STOP=1 -q -f /opt/boot/03-admin-audit-prod.sql 2>/tmp/e1 || AUD="falha-sql: $(head -c 300 /tmp/e1)"
if [ "$AUD" = ok ]; then
  DSN=$(grep '^DATABASE_URL=' "$ENV" | cut -d= -f2-)
  psql -v ON_ERROR_STOP=1 -q "$DSN" -f /opt/boot/verificar-auditoria.sql 2>/tmp/e2 || AUD="falha-verif: $(head -c 400 /tmp/e2)"
  psql -q -c "DELETE FROM platform.admin_audit WHERE operador='teste' AND detalhe='verificacao'" 2>/dev/null
  unset DSN
fi

# --- 3. dashboard (Basic Auth) ----------------------------------------------
# Senha em claro so neste volume (600, UID do hermes). Mesma exposicao do
# DATABASE_URL. O fluxo de boas-vindas manda trocar no primeiro acesso.
tem HERMES_DASHBOARD_BASIC_AUTH_USERNAME || poe HERMES_DASHBOARD_BASIC_AUTH_USERNAME "$SLUG"
tem HERMES_DASHBOARD_BASIC_AUTH_PASSWORD || poe HERMES_DASHBOARD_BASIC_AUTH_PASSWORD "$(rnd 24)"
# Chave HMAC das sessoes. Sem ela, todo restart desloga todo mundo.
tem HERMES_DASHBOARD_BASIC_AUTH_SECRET   || poe HERMES_DASHBOARD_BASIC_AUTH_SECRET "$(openssl rand -base64 32 | tr -d '\n')"

# --- 4. Admin API: SO o hash no .env; token em arquivo para leitura unica ---
TOK=preservado
if ! tem ADMIN_API_TOKEN_SHA256; then
  T=$(rnd 40)
  H=$(printf '%s' "$T" | sha256sum | cut -d' ' -f1)
  poe ADMIN_API_TOKEN_SHA256 "$H"
  printf '%s\n' "$T" > /opt/data/ADMIN_API_TOKEN.leia-e-apague
  chmod 600 /opt/data/ADMIN_API_TOKEN.leia-e-apague
  unset T H
  TOK=gerado
fi
tem ADMIN_AUDIT_DSN || poe ADMIN_AUDIT_DSN "$(grep '^DATABASE_URL=' "$ENV" | cut -d= -f2-)"
tem TENANT_SLUG || poe TENANT_SLUG "$SLUG"

# --- 5. dono e permissao: imagem oficial roda como hermes, UID 10000 -------
chown -R 10000:10000 /opt/data
chmod 600 "$ENV"

CHAVES=$(cut -d= -f1 "$ENV" | grep -v '^#' | grep . | sort | tr '\n' ' ')
echo "PREPARO $SLUG"
echo "DATABASE_URL: $STATUS_DB"
echo "auditoria: $AUD"
echo "token admin api: $TOK"
echo "chaves: $CHAVES"
echo "perm=$(stat -c %a "$ENV") dono=$(stat -c %u:%g "$ENV")"
[ "$AUD" = ok ] && [ "$STATUS_DB" != falha ] && echo PREPARO-OK
