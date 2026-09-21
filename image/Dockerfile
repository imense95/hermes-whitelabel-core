# image/Dockerfile — imagem white-label derivada do Hermes.
# NAO e' um fork: o core fica intacto e atualiza por `docker pull` de uma tag
# nova na linha FROM. Toda customizacao entra por plugin, skill, skin e config.

# Sem default proposital: build sem --build-arg HERMES_TAG falha na hora,
# em vez de assar :latest e mudar de versao sozinho no proximo build.
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
        uv venv /opt/venv-servicos; \
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
RUN chmod -R a-w /opt/product /opt/admin-api /opt/proxy

# --- Supervisao ------------------------------------------------------------
# A imagem oficial usa s6. A Admin API entra como servico irmao do gateway:
# se cair, o s6 levanta de novo sem derrubar o container.
COPY image/s6/admin-api/ /etc/s6-overlay/s6-rc.d/admin-api/
RUN chmod +x /etc/s6-overlay/s6-rc.d/admin-api/run \
 && touch /etc/s6-overlay/s6-rc.d/user/contents.d/admin-api

USER hermes

LABEL org.opencontainers.image.title="hermes-whitelabel" \
      org.opencontainers.image.description="Plataforma de agentes white-label" \
      com.hermes.upstream-tag="${HERMES_TAG}"
