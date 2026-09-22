#!/bin/sh
# Ativa a skill de marketing no profile isolado "marketing" da instância.
# Roda DENTRO do container (uid hermes). Nunca imprime valor de segredo.
set -eu
DATA=/opt/data
P=$DATA/profiles/marketing
CAT=/opt/product

# 1. profile (sem clone: memória, sessões, skills e plugins vazios)
if [ ! -d "$P" ]; then
  hermes profile create marketing --no-skills --description "Bot de marketing (skill universal) — Urban" >/dev/null
  echo "profile criado"
else
  echo "profile já existia"
fi

# 2. .env do profile — cada chave só se ainda não estiver lá (idempotente)
ENVF=$P/.env
touch "$ENVF"; chmod 600 "$ENVF"
add() {  # add NOME VALOR
  [ -n "$2" ] || { echo "  $1: SEM VALOR NA ORIGEM — pulei"; return; }
  if grep -q "^$1=" "$ENVF"; then echo "  $1: já existia"; else printf '%s=%s\n' "$1" "$2" >> "$ENVF"; echo "  $1: gravada (${#2} chars)"; fi
}
from_env_file() { grep -E "^$1=" "$DATA/.env" | head -1 | cut -d= -f2-; }
echo "--- .env do profile ---"
add DATABASE_URL        "$(from_env_file DATABASE_URL)"
add ANTHROPIC_API_KEY   "$(from_env_file ANTHROPIC_API_KEY)"
add GEMINI_API_KEY      "$(printenv GEMINI_API_KEY || true)"
add MARKETING_GOOGLE_CLIENT_ID     "$(printenv MARKETING_GOOGLE_CLIENT_ID || true)"
add MARKETING_GOOGLE_CLIENT_SECRET "$(printenv MARKETING_GOOGLE_CLIENT_SECRET || true)"
# chave PRÓPRIA do profile: cifra o refresh token do Drive. Gerada aqui, nunca sai.
add API_SERVER_KEY      "$(openssl rand -hex 32)"
add MARKETING_STATE_DIR "$P/marketing"
mkdir -p "$P/marketing"

# 3. plugin (sem motor/) + skill dentro do profile
mkdir -p "$P/plugins" "$P/skills"
rm -rf "$P/plugins/marketing"; mkdir -p "$P/plugins/marketing"
for f in "$CAT"/plugins/marketing/*; do case "$(basename "$f")" in motor|__pycache__) ;; *) cp -r "$f" "$P/plugins/marketing/";; esac; done
rm -rf "$P/skills/marketing-conteudo"; cp -r "$CAT/skills/marketing-conteudo" "$P/skills/"
echo "plugin: $(ls $P/plugins/marketing | tr '\n' ' ')"
echo "skill:  $(ls $P/skills/marketing-conteudo | tr '\n' ' ')"

# 4. config do profile: modelo + plugin habilitado (via CLI, nunca editando YAML na mão)
hermes -p marketing config set model.provider anthropic >/dev/null 2>&1 || true
hermes -p marketing config set model.default claude-sonnet-4-6 >/dev/null 2>&1 || true
hermes -p marketing config set plugins.enabled '["marketing"]' >/dev/null 2>&1 || python3 - "$P/config.yaml" <<'PY'
import sys, yaml, pathlib
p = pathlib.Path(sys.argv[1]); cfg = yaml.safe_load(p.read_text()) if p.exists() else {}
cfg = cfg or {}; cfg.setdefault("plugins", {})["enabled"] = ["marketing"]
p.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False))
PY
echo "--- config.yaml do profile ---"; grep -A2 -E "^(plugins|model):" "$P/config.yaml" | grep -vE "^\s*$" || cat "$P/config.yaml"

# 5. SOUL.md
cat > "$P/SOUL.md" <<'EOF'
# Assistente de marketing da Urban Passageiro

Você é o assistente de conteúdo da Urban Passageiro (transporte por aplicativo
em Alta Floresta, MT). Sua única função é produzir posts de Instagram fiéis à
identidade visual da marca, usando a skill `marketing-conteudo` e as
ferramentas `marketing_*`. Fale em português do Brasil, direto e cordial.

Regras:
- Comece sempre por `marketing_config action=status`. Se a marca não estiver
  configurada, conduza o onboarding etapa por etapa (uma pergunta por vez).
- Nunca gere arte sem mostrar a estimativa e receber um "pode" explícito.
- O conteúdo vai para o Google Drive do cliente; nunca guarde arte aqui.
- Nunca mostre, peça ou repita chaves ou tokens.
EOF
echo "SOUL.md escrito"

# 6. prova: o profile enxerga as tools?
echo "--- tools no profile ---"
hermes -p marketing tools list 2>/dev/null | grep -iE "marketing" || echo "(tools list não mostrou marketing — checar no chat)"
ls -la "$P" | head -20
