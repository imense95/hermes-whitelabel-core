#!/usr/bin/env bash
# infra/scripts/migrate.sh [slug|--all]
#
# Aplica db/migrations/*.sql em UM schema ou em todos os tenants ativos.
# Cada schema tem sua propria tabela schema_migrations: um cliente pode ficar
# uma versao atras sem travar os outros.
set -euo pipefail

TARGET="${1:?uso: migrate.sh <slug>|--all}"
PG_DB="${PG_DB:-app}"
PG_SUPERUSER="${PG_SUPERUSER:-platform}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG_DIR="${HERE}/../db/migrations"
COMPOSE="docker compose -f ${HERE}/../docker-compose.yml"

psql_admin() { $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PG_SUPERUSER" -d "$PG_DB" "$@"; }

if [[ "$TARGET" == "--all" ]]; then
  mapfile -t SCHEMAS < <(psql_admin -tAc \
    "SELECT schema_name FROM platform.tenants WHERE status = 'ativo' ORDER BY slug")
else
  SCHEMAS=("$TARGET")
fi

for SCHEMA in "${SCHEMAS[@]}"; do
  echo "=== schema ${SCHEMA}"
  psql_admin -c "
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (
      versao     text PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    );" >/dev/null

  for FILE in "${MIG_DIR}"/*.sql; do
    [[ -e "$FILE" ]] || { echo "  (nenhuma migracao em ${MIG_DIR})"; break; }
    VERSAO="$(basename "$FILE" .sql)"

    JA="$(psql_admin -tAc \
      "SELECT 1 FROM ${SCHEMA}.schema_migrations WHERE versao = '${VERSAO}'")"
    if [[ -n "$JA" ]]; then
      echo "  [=] ${VERSAO}"
      continue
    fi

    echo "  [+] ${VERSAO}"
    # search_path faz a mesma migracao servir todos os schemas sem reescrita.
    # Tudo numa transacao: migracao que falha nao deixa schema pela metade.
    {
      echo "BEGIN;"
      echo "SET LOCAL search_path = ${SCHEMA};"
      cat "$FILE"
      echo "INSERT INTO ${SCHEMA}.schema_migrations (versao) VALUES ('${VERSAO}');"
      echo "COMMIT;"
    } | psql_admin -f -
  done
done

echo "migracoes concluidas"
