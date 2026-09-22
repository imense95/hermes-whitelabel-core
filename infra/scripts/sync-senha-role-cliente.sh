#!/bin/sh
# No HOST. Sincroniza a senha da role urban_app com a que esta' na DATABASE_URL
# real do .env da Urban (mesma tecnica do kcsync.sh). Nada e' impresso.
set -eu
C=$(docker ps -q -f name=hermes-whitelabel_urban | head -1)
DB=$(docker ps -q -f name=hermes-whitelabel_plataforma-db | head -1)
PW=$(docker exec "$C" sh -c 'grep -E "^DATABASE_URL=" /opt/data/.env | head -1 | cut -d= -f2-' | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const u=new URL(s.trim());process.stdout.write(decodeURIComponent(u.password));});' 2>/dev/null || true)
if [ -z "$PW" ]; then
  # node pode nao existir no host: extrai com sed (senha sem @ e sem :)
  PW=$(docker exec "$C" sh -c 'grep -E "^DATABASE_URL=" /opt/data/.env | head -1 | cut -d= -f2-' | sed -E 's#^[a-z]+://[^:]+:([^@]+)@.*#\1#')
fi
echo "senha lida do .env: ${#PW} chars"
docker exec -i -e PW="$PW" "$DB" psql -U plataforma_admin -d plataforma -v ON_ERROR_STOP=1 -q -v pw="$PW" <<'SQL'
alter role urban_app with password :'pw';
select rolname, rolpassword is not null as tem_senha from pg_authid where rolname='urban_app';
SQL
