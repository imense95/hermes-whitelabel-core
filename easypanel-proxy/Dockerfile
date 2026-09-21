# Proxy do EasyPanel — servico separado, imagem minima.
# Roda ISOLADO da Admin API: comprometer um nao entrega o outro.
FROM python:3.12-slim

WORKDIR /opt/proxy
COPY easypanel-proxy/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY easypanel-proxy/app.py .
RUN chmod -R a-w /opt/proxy

# usuario sem privilegio: o proxy nao precisa de nada do sistema
RUN useradd --system --no-create-home proxy
USER proxy

EXPOSE 8778
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8778", "--no-access-log"]
