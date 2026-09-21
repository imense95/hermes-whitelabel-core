#!/usr/bin/env bash
# infra/scripts/provision-tenant.sh <slug> "<Nome do cliente>"
#
# Idempotente: rodar duas vezes nao quebra nem regenera a senha.
# Cria role + schema isolados no Postgres compartilhado e o diretorio de
# dados do container. NAO sobe o container (isso e' `docker compose up`).
set -euo pipefail

SLUG="${1:?uso: provision-tenant.sh <slug> \"<Nome>\"}"
NOME="${2:-$SLUG}"

[[ "$SLUG" =~ ^[a-z][a-z0-9_]{1,30}$ ]] || {
  echo "slug invalido: use [a-z][a-z0-9_], 2-31 chars (vira nome de schema e de role)" >&2
  exit 1
}

ROLE="${SLUG}_app"
DATA_DIR="${CLIENT_DATA_ROOT:-/srv/hermes}/${SLUG}"
PG_DB="${PG_DB:-app}"
PG_SUPERUSER="${PG_SUPERUSER:-platform}"
COMPOSE="docker compose -f $(dirname "$0")/../docker-compose.yml"

psql_admin() { $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PG_SUPERUSER" -d "$PG_DB" "$@"; }

# --- senha: gera na primeira vez, reusa depois -------------------------------
mkdir -p "$DATA_DIR"
SECRET_FILE="${DATA_DIR}/.pgpass-role"
if [[ -f "$SECRET_FILE" ]]; then
  PGPASS="$(cat "$SECRET_FILE")"
  echo "[=] senha da role ja existia, reaproveitando"
else
  PGPASS="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
  umask 077 && printf '%s' "$PGPASS" > "$SECRET_FILE"
  echo "[+] senha da role gerada"
fi

# --- role + schema -----------------------------------------------------------
echo "[*] provisionando role ${ROLE} e schema ${SLUG} em ${PG_DB}"
psql_admin <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
    CREATE ROLE ${ROLE} LOGIN;
  END IF;
END
\$\$;

ALTER ROLE ${ROLE} WITH PASSWORD '${PGPASS}';
ALTER ROLE ${ROLE} SET search_path = ${SLUG};
ALTER ROLE ${ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

CREATE SCHEMA IF NOT EXISTS ${SLUG} AUTHORIZATION ${ROLE};
GRANT CONNECT ON DATABASE ${PG_DB} TO ${ROLE};

-- explicitar o que ele NAO tem: nada fora do proprio schema
REVOKE ALL ON SCHEMA public   FROM ${ROLE};
REVOKE ALL ON SCHEMA platform FROM ${ROLE};

INSERT INTO platform.tenants (slug, nome, schema_name, db_role)
VALUES ('${SLUG}', '${NOME}', '${SLUG}', '${ROLE}')
ON CONFLICT (slug) DO UPDATE
  SET nome = EXCLUDED.nome, atualizado_em = now();
SQL

# --- diretorio de dados do container ----------------------------------------
if [[ ! -f "${DATA_DIR}/.env" ]]; then
  umask 077
  cat > "${DATA_DIR}/.env" <<ENV
# Segredos da instancia ${SLUG}. SO segredo aqui — ajuste de comportamento
# vai em config.yaml via 'hermes config set'.
DATABASE_URL=postgresql://${ROLE}:${PGPASS}@postgres:5432/${PG_DB}?options=-csearch_path%3D${SLUG}

# preencher:
# OPENROUTER_API_KEY=
# URBAN_API_TOKEN=
# HERMES_DASHBOARD_OIDC_ISSUER=
# HERMES_DASHBOARD_OIDC_CLIENT_ID=
ENV
  echo "[+] ${DATA_DIR}/.env criado — preencha as chaves pendentes"
else
  echo "[=] ${DATA_DIR}/.env ja existe, intacto"
fi

mkdir -p "${DATA_DIR}"/{skills,memories,sessions,logs,cron,home}

cat <<EOF

pronto: ${SLUG}
  schema : ${SLUG}
  role   : ${ROLE} (search_path travado, sem acesso a public/platform)
  dados  : ${DATA_DIR}

proximos passos:
  1. preencha as chaves em ${DATA_DIR}/.env
  2. crie infra/clients/${SLUG}.yml (copie urban.yml, troque o slug)
  3. docker compose -f docker-compose.yml -f clients/${SLUG}.yml up -d hermes-${SLUG}
  4. scripts/migrate.sh ${SLUG}
EOF
