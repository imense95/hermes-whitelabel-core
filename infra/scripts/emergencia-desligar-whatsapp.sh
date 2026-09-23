#!/bin/sh
# Limpeza de emergência do WhatsApp na instância (roda em alpine com o volume da instância em /d).
# 1) apaga a sessão Baileys (creds.json etc.)  2) desliga WHATSAPP_ENABLED no .env  3) desliga no config.yaml
# Não imprime nenhum valor de segredo. Mantém dono/permissão do .env (uid 10000, 600).
set -e
D=/d
echo "== antes"
for p in "$D/platforms/whatsapp/session" "$D/whatsapp/session"; do
  [ -d "$p" ] && echo "sessao: $p ($(ls -1 "$p" | wc -l) arquivos)" || echo "sessao ausente: $p"
done
grep -c '^WHATSAPP_' "$D/.env" 2>/dev/null | sed 's/^/linhas WHATSAPP_ no .env: /' || true

echo "== limpando sessao"
rm -rf "$D/platforms/whatsapp/session" "$D/whatsapp/session"
# (não usar `find -delete` em volume swarm: rm -rf basta e é atômico o bastante aqui)

echo "== .env: WHATSAPP_ENABLED=false (demais chaves WHATSAPP_ preservadas)"
if [ -f "$D/.env" ]; then
  if grep -q '^WHATSAPP_ENABLED=' "$D/.env"; then
    sed -i 's/^WHATSAPP_ENABLED=.*/WHATSAPP_ENABLED=false/' "$D/.env"
  else
    printf '\nWHATSAPP_ENABLED=false\n' >> "$D/.env"
  fi
  chown 10000:10000 "$D/.env"; chmod 600 "$D/.env"
fi

echo "== config.yaml: platforms.whatsapp.enabled=false (se existir bloco)"
if [ -f "$D/config.yaml" ] && grep -q 'whatsapp:' "$D/config.yaml"; then
  # troca só o 'enabled: true' que estiver dentro do bloco whatsapp (indentação maior que a chave)
  awk '
    /^[[:space:]]*whatsapp:[[:space:]]*$/ { inblk=1; ind=match($0,/[^ ]/); print; next }
    inblk && match($0,/[^ ]/) <= ind && $0 !~ /^[[:space:]]*$/ { inblk=0 }
    inblk && /^[[:space:]]*enabled:[[:space:]]*true/ { sub(/true/,"false") }
    { print }
  ' "$D/config.yaml" > "$D/config.yaml.tmp" && mv "$D/config.yaml.tmp" "$D/config.yaml"
  chown 10000:10000 "$D/config.yaml"
fi

echo "== depois"
[ -e "$D/platforms/whatsapp/session" ] || echo "sessao removida OK"
grep -E '^WHATSAPP_ENABLED=' "$D/.env" || echo "(sem WHATSAPP_ENABLED)"
grep -nE 'whatsapp:|enabled:' "$D/config.yaml" 2>/dev/null | head -8 || true
echo "LIMPEZA_OK"
exec sleep 3600
