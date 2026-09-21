# image/Dockerfile — imagem white-label derivada do Hermes.
# NAO e' um fork: o core fica intacto e atualiza por `docker pull` de uma tag
# nova na linha FROM. Toda customizacao entra por plugin, skill, skin e config.

ARG HERMES_TAG=latest
FROM nousresearch/hermes-agent:${HERMES_TAG}

USER root

# --- Admin API (plano B: acesso tecnico da assessoria) ---------------------
# Processo separado, porta propria, nunca fala com o agente.
COPY admin-api/requirements.txt /opt/admin-api/requirements.txt
RUN /opt/hermes/.venv/bin/pip install --no-cache-dir -r /opt/admin-api/requirements.txt
COPY admin-api/app.py /opt/admin-api/app.py

# --- Catalogo do produto ---------------------------------------------------
# Marca e comportamento. Origem unica das skills que a assessoria instala;
# root-owned e sem escrita para o runtime, entao o agente nao reescreve o
# proprio catalogo. O estado mutavel continua sendo so /opt/data.
COPY --chown=root:root product/skills/  /opt/product/skills/
COPY --chown=root:root product/plugins/ /opt/product/plugins/
COPY --chown=root:root product/skins/   /opt/product/skins/
COPY --chown=root:root product/config/  /opt/product/config/
RUN chmod -R a-w /opt/product /opt/admin-api

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
