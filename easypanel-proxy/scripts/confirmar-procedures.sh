#!/usr/bin/env bash
# easypanel-proxy/scripts/confirmar-procedures.sh
#
# Confirma, contra o SEU painel, que as procedures da allowlist respondem e
# que nao devolvem campo sensivel. Mostra so as CHAVES de cada resposta,
# nunca os valores.
#
# A lista abaixo NAO e' chute: veio da referencia oficial da API
# (https://easypanel.io/docs/api/...). O que se confirma aqui e' que a SUA
# versao do painel tem essas rotas e o que exatamente elas devolvem.
#
# Rode VOCE, com a chave admin no ambiente. O agente nao participa deste
# passo — e' justamente o passo que exige a chave crua.
#
# Windows: chame o bash do Git explicitamente, senao o WSL pega e nao enxerga
# as variaveis do PowerShell:
#   & "C:\Program Files\Git\bin\bash.exe" ./confirmar-procedures.sh dashboard api
#
#   EASYPANEL_URL=https://painel.seudominio \
#   EASYPANEL_API_KEY=... \
#   ./confirmar-procedures.sh <projeto> <servico>
set -euo pipefail

: "${EASYPANEL_URL:?defina EASYPANEL_URL}"
: "${EASYPANEL_API_KEY:?defina EASYPANEL_API_KEY}"

PROJETO="${1:-}"
SERVICO="${2:-}"

# A API do EasyPanel e' PLANA: GET /api/<procedure>?param=valor
# O agrupamento da documentacao (projects/, logs/, metrics/) e' so
# organizacao das paginas e NAO entra na URL. Nao existe /api/trpc/ — a
# primeira versao deste script usava esse prefixo e levou 404 em tudo.
BASE="${EASYPANEL_URL%/}/api"

SEM_ALVO=(
  listProjects
  getUpdateStatus
  getMetricsSettings
  getLogsSettings
  getLogsStats
  getAllServicesStats
  getMetricsSystemStats
)

COM_ALVO=(
  queryServiceLogs
  queryComposeServiceLogs
  getMetricsServiceStats
  listPorts
  listMounts
)

testar() {
  local proc="$1"; shift
  local resp http corpo
  resp="$(curl -sS -w $'\n%{http_code}' -G "$@" \
    -H "Authorization: Bearer ${EASYPANEL_API_KEY}" \
    "${BASE}/${proc}" 2>/dev/null || printf '\n000')"
  http="$(printf '%s' "$resp" | tail -1)"
  corpo="$(printf '%s' "$resp" | sed '$d')"

  if [[ "$http" != "200" ]]; then
    printf '  %-26s http %s\n' "$proc" "$http"
    return
  fi

  # so as CHAVES, nunca os valores
  local chaves
  chaves="$(printf '%s' "$corpo" | python -c '
import json, sys
def coletar(o, pref="", saida=None, n=0):
    saida = saida if saida is not None else set()
    if n > 4: return saida
    if isinstance(o, dict):
        for k, v in o.items():
            saida.add(f"{pref}{k}")
            coletar(v, f"{pref}{k}.", saida, n + 1)
    elif isinstance(o, list) and o:
        coletar(o[0], pref, saida, n + 1)
    return saida
try:
    print(" ".join(sorted(coletar(json.load(sys.stdin)))[:40]))
except Exception as e:
    print(f"<nao-json: {e}>")
' 2>/dev/null || printf '<falha ao ler>')"

  local alerta=""
  if printf '%s' "$chaves" | grep -qiE 'token|secret|password|senha|apikey|api_key|credential|(^|\.)env(\.|$)|authorization|twofactor|otp|dsn'; then
    alerta="   <<< CAMPO SENSIVEL: me avise antes de usar"
  fi

  printf '  %-26s OK%s\n' "$proc" "$alerta"
  printf '      %s\n' "${chaves:0:400}"
}

echo "painel: ${BASE}"
echo
echo "== sem alvo =="
for p in "${SEM_ALVO[@]}"; do testar "$p"; done

if [[ -n "$PROJETO" && -n "$SERVICO" ]]; then
  echo
  echo "== com alvo (${PROJETO}/${SERVICO}) =="
  for p in "${COM_ALVO[@]}"; do
    testar "$p" --data-urlencode "projectName=${PROJETO}" \
                --data-urlencode "serviceName=${SERVICO}"
  done

  echo
  echo "== containers =="
  testar getDockerContainers --data-urlencode "service=${PROJETO}_${SERVICO}"
else
  echo
  echo "(passe <projeto> <servico> para testar as rotas que exigem alvo)"
fi

cat <<'EOF'

Leitura do resultado:
  200 sem alerta  -> ja esta na allowlist do proxy, nada a fazer.
  404             -> sua versao do painel nao tem essa rota; me avise para eu
                     tirar da allowlist (o proxy devolve 502, nao quebra).
  CAMPO SENSIVEL  -> me mostre a linha. O scrub redige, mas talvez a rota
                     deva sair da allowlist de vez.
  401/403         -> chave sem permissao para o recurso.

Logs vazios nao sao erro: queryServiceLogs depende da agregacao de logs
(Loki) estar ligada no painel. getLogsSettings mostra se esta.
EOF
