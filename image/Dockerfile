# image/Dockerfile — imagem white-label derivada do Hermes.
# NAO e' um fork: o core fica intacto e atualiza por `docker pull` de uma tag
# nova na linha FROM. Toda customizacao entra por plugin, skill, skin e config.

# Sem default proposital: build sem --build-arg HERMES_TAG falha na hora,
# em vez de assar :latest e mudar de versao sozinho no proximo build.
ARG HERMES_TAG

# --- Estagio de build do client-ui (front-end do cliente final) ------------
# App separado do dashboard de dev (React+Vite+Tailwind, estetica AIChat).
# Buildado aqui e servido pelo proprio gateway via HERMES_WEB_DIST (abaixo),
# para o cliente abrir o chat na origin da instancia atras do OIDC do Keycloak.
# node:20 e' descartado: nada deste estagio vai para a imagem final alem do dist.
FROM node:20-alpine AS client-ui-build
WORKDIR /build
# Camada de deps separada do codigo: cache do npm ci sobrevive a mudanca de src.
COPY client-ui/package.json client-ui/package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY client-ui/ ./
# Build de producao (tsc -b + vite build). base padrao "/" = servido na raiz.
RUN npm run build && test -f dist/index.html

ARG HERMES_TAG
FROM nousresearch/hermes-agent:${HERMES_TAG}

# ARG declarado antes do FROM sai de escopo depois dele. Sem redeclarar, o
# LABEL com a tag do upstream sairia VAZIO — e a imagem perderia a unica
# prova de qual versao do Hermes ela carrega.
ARG HERMES_TAG

USER root

# --- Admin API e proxy (plano B: acesso tecnico da assessoria) -------------
# Processos separados, portas proprias, nunca falam com o agente.
#
# Venv PROPRIO, nao o do Hermes: as dependencias da nossa API nao podem
# conflitar com as do core, e o core atualiza por baixo de nos a cada tag
# nova. O venv do upstream (/opt/hermes/.venv) nao tem pip — e' criado com
# uv — entao usamos uv, com ensurepip como plano B.
COPY admin-api/requirements.txt     /opt/admin-api/requirements.txt
COPY easypanel-proxy/requirements.txt /opt/proxy/requirements.txt
RUN set -eu; \
    if command -v uv >/dev/null 2>&1; then \
        uv venv --python /opt/hermes/.venv/bin/python /opt/venv-servicos; \
        VIRTUAL_ENV=/opt/venv-servicos uv pip install --no-cache \
            -r /opt/admin-api/requirements.txt \
            -r /opt/proxy/requirements.txt; \
    else \
        /opt/hermes/.venv/bin/python -m venv /opt/venv-servicos; \
        /opt/venv-servicos/bin/python -m ensurepip --upgrade; \
        /opt/venv-servicos/bin/pip install --no-cache-dir \
            -r /opt/admin-api/requirements.txt \
            -r /opt/proxy/requirements.txt; \
    fi; \
    /opt/venv-servicos/bin/python -c "import fastapi, uvicorn, httpx"
COPY admin-api/app.py       /opt/admin-api/app.py
COPY easypanel-proxy/app.py /opt/proxy/app.py

# --- Catalogo do produto ---------------------------------------------------
# Marca e comportamento. Origem unica das skills que a assessoria instala;
# root-owned e sem escrita para o runtime, entao o agente nao reescreve o
# proprio catalogo. O estado mutavel continua sendo so /opt/data.
COPY --chown=root:root product/skills/  /opt/product/skills/
COPY --chown=root:root product/plugins/ /opt/product/plugins/
COPY --chown=root:root product/skins/   /opt/product/skins/
COPY --chown=root:root product/config/  /opt/product/config/

# --- Front-end do cliente (client-ui) --------------------------------------
# O dist buildado no estagio node acima. Vai para um caminho PROPRIO
# (/opt/product/client-ui), NAO sobrescreve o web_dist de estoque do dashboard
# de dev — assim a troca e' reversivel (basta remover a env HERMES_WEB_DIST).
# O gateway le o conteudo por request; o caminho vem da env, lida no boot.
COPY --chown=root:root --from=client-ui-build /build/dist/ /opt/product/client-ui/

# --- Motores Node dos plugins do catalogo ----------------------------------
# A imagem upstream ja traz node + ffmpeg (usados pelo proprio Hermes), entao
# so instalamos as dependencias de cada plugin que tiver package-lock.json.
# `npm ci --omit=dev`: reproduzivel (lock) e sem ferramentas de teste na
# imagem. Fica root-owned e read-only como o resto do catalogo; o estado
# mutavel dos motores (jobs, temporarios) vai para /opt/data via
# MARKETING_STATE_DIR / TMPDIR, nunca para dentro de /opt/product.
RUN set -eu; \
    for lock in /opt/product/plugins/*/motor/package-lock.json; do \
        [ -f "$lock" ] || continue; \
        d="$(dirname "$lock")"; echo "npm ci em $d"; \
        (cd "$d" && npm ci --omit=dev --no-audit --no-fund --loglevel=error); \
        rm -rf "$d/test"; \
    done; \
    npm cache clean --force 2>/dev/null || true; \
    if [ -f /opt/product/plugins/marketing/motor/agent/hermes/cli.js ]; then \
        cd /opt/product/plugins/marketing/motor && node agent/hermes/cli.js | grep -q marketing_config; \
    fi
RUN chmod -R a-w /opt/product /opt/admin-api /opt/proxy

# --- Supervisao ------------------------------------------------------------
# A imagem oficial usa s6. A Admin API entra como servico irmao do gateway:
# se cair, o s6 levanta de novo sem derrubar o container.
COPY image/s6/admin-api/ /etc/s6-overlay/s6-rc.d/admin-api/
RUN chmod +x /etc/s6-overlay/s6-rc.d/admin-api/run \
 && touch /etc/s6-overlay/s6-rc.d/user/contents.d/admin-api

USER hermes

# A imagem do produto serve o client-ui (chat do cliente) por padrao. Reversivel
# por instancia: sobrepor HERMES_WEB_DIST no env do EasyPanel (ex. para o
# dashboard de dev de estoque) OU remove-la volta ao web_dist embutido do core.
# O gateway le o conteudo por request; o caminho vem desta env, lida no boot.
ENV HERMES_WEB_DIST=/opt/product/client-ui

LABEL org.opencontainers.image.title="hermes-whitelabel" \
      org.opencontainers.image.description="Plataforma de agentes white-label" \
      com.hermes.upstream-tag="${HERMES_TAG}"
