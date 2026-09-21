"""
EasyPanel Proxy — superficie minima e travada no codigo.

Por que existe
--------------
O plano atual do EasyPanel nao permite usuario separado de diagnostico, entao
a unica chave disponivel e' a de admin pleno. Dar essa chave ao agente
significaria: (a) poder de `execute_destructive` em toda a producao, e (b)
leitura de procedures que devolvem segredo em texto plano — foi exatamente
assim que `getUser` despejou o apiToken e o twoFactorSecret num resultado
marcado como "somente leitura".

Este proxy fica com a chave admin. O agente fala so com ele.

As tres camadas, nesta ordem
----------------------------
1. ALLOWLIST de procedures. O que nao esta na lista nao passa. Uma denylist
   erraria por omissao a cada versao nova do EasyPanel.
2. DENYLIST explicita por cima, para as procedures que ja sabemos que vazam.
   Redundante de proposito: se alguem ampliar a allowlist sem pensar, a
   denylist ainda segura.
3. SCRUB recursivo da resposta. Mesmo numa procedure permitida, qualquer
   campo com cara de segredo e' substituido antes de sair. Defesa contra o
   caso que nao previmos.

E o mais importante: este processo **so sabe fazer chamada de leitura**. Nao
ha caminho de codigo que emita mutation ou destructive. Nao e' politica, nao
e' instrucao no prompt — a funcao nao existe.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel

# --------------------------------------------------------------------------
# Configuracao
# --------------------------------------------------------------------------

EASYPANEL_URL = os.environ.get("EASYPANEL_URL", "").rstrip("/")
EASYPANEL_KEY = os.environ.get("EASYPANEL_API_KEY", "")
PROXY_TOKEN_HASH = os.environ.get("PROXY_TOKEN_SHA256", "")
LOG_DIR = Path(os.environ.get("PROXY_LOG_DIR", "/opt/data/logs"))
TIMEOUT = float(os.environ.get("EASYPANEL_TIMEOUT", "30"))

# --------------------------------------------------------------------------
# Camada 1 — ALLOWLIST
# --------------------------------------------------------------------------
# Toda procedure aqui e' `risk: query` e foi conferida por nao devolver
# credencial. Adicionar entrada exige conferir a resposta real primeiro.
#
# Ausencias deliberadas:
#   listProjectsAndServices  -> devolve `env` e `token` de todo servico da
#                               producao. E' a procedure que mais vaza no
#                               painel inteiro. Substituida por /v1/projects
#                               + /v1/services, que projetam so o que presta.
#   getUser / getSession     -> apiToken, twoFactorSecret.
#   listAccounts/listTunnels -> recebem apiToken do Cloudflare como INPUT.
#   getWordPressUsers        -> contas e papeis de usuario final.

ALLOWLIST: dict[str, dict[str, Any]] = {
    # --- painel ---
    "listProjects":          {"desc": "nomes e datas dos projetos"},
    "getUpdateStatus":       {"desc": "versao do painel e se ha atualizacao"},
    "getMetricsSettings":    {"desc": "configuracao de metricas"},
    "getLogsSettings":       {"desc": "configuracao da agregacao de logs"},

    # --- logs (Loki) ---
    "queryServiceLogs":      {"desc": "logs de um servico",
                              "requer": ("projectName", "serviceName")},
    "queryComposeServiceLogs": {"desc": "logs de um servico Compose",
                                "requer": ("projectName", "serviceName")},

    # --- metricas (Prometheus) ---
    "getAllServicesStats":   {"desc": "metricas atuais de todos os servicos"},
    "getMetricsServiceStats": {"desc": "metricas de um servico ao longo do tempo",
                               "requer": ("projectName", "serviceName")},
    "getMetricsSystemStats": {"desc": "metricas do sistema"},
    "getLogsStats":          {"desc": "uso de disco/recursos do Loki e Promtail"},

    # --- containers ---
    "getDockerContainers":   {"desc": "containers rodando de um servico",
                              "requer": ("service",)},

    # --- servico ---
    "listPorts":             {"desc": "portas expostas de um servico",
                              "requer": ("projectName", "serviceName")},
    "listMounts":            {"desc": "mounts de um servico",
                              "requer": ("projectName", "serviceName")},
}

# CONFERIDOS NA DOCUMENTACAO, MAS FORA DA ALLOWLIST DE PROPOSITO
# ---------------------------------------------------------------
# inspectProject / inspectAppService / inspectPostgresService: sao os mais
# uteis para diagnostico E os que mais vazam — a resposta traz `env` do
# servico inteiro. O scrub redigiria, mas uma procedure cuja razao de ser e'
# devolver configuracao completa nao e' procedure de diagnostico restrito.
# Se um caso real exigir, exponha um endpoint que projete campos
# especificos, em vez de abrir a procedure.

# --------------------------------------------------------------------------
# Camada 2 — DENYLIST (redundante por design)
# --------------------------------------------------------------------------
DENYLIST = frozenset({
    "getUser", "getSession", "listProjectsAndServices",
    "getWordPressUsers", "listAccounts", "listTunnels", "listZones",
    "listStorageProviderOptions", "createUser", "updateUser",
})

# Qualquer nome que cheire a escrita tambem cai, mesmo se entrar na allowlist
# por engano.
PREFIXO_ESCRITA = re.compile(
    r"^(create|update|delete|destroy|remove|restart|stop|start|deploy|"
    r"enable|disable|set|reset|rotate|revoke|restore|import|exec)",
    re.IGNORECASE,
)

# --------------------------------------------------------------------------
# Camada 3 — SCRUB
# --------------------------------------------------------------------------
CHAVE_SECRETA = re.compile(
    r"token|secret|password|passwd|senha|apikey|api_key|credential|"
    r"privatekey|private_key|\benv\b|authorization|bearer|dsn|"
    r"connectionstring|connection_string|twofactor|two_factor|otp|seed",
    re.IGNORECASE,
)
# Valores que parecem segredo mesmo sob chave de nome inocente.
VALOR_SECRETO = re.compile(
    r"(gh[pousr]_[A-Za-z0-9]{16,})"           # PAT do GitHub
    r"|(sk-[A-Za-z0-9_\-]{16,})"              # chave estilo OpenAI
    r"|(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})"  # JWT
    r"|(postgres(?:ql)?://[^\s\"']+)"         # DSN
    r"|(\b[a-f0-9]{48,}\b)"                   # hex longo (apiToken EasyPanel)
)
REDIGIDO = "[REDIGIDO PELO PROXY]"


def scrub(valor: Any, _nivel: int = 0) -> Any:
    """Remove segredo de qualquer forma que a resposta tenha.

    Roda em TODA resposta, inclusive de procedure permitida. O custo e'
    irrelevante perto de vazar um token no contexto de um LLM.
    """
    if _nivel > 24:
        return "[PROFUNDO DEMAIS]"
    if isinstance(valor, dict):
        saida = {}
        for k, v in valor.items():
            if CHAVE_SECRETA.search(str(k)):
                saida[k] = REDIGIDO
            else:
                saida[k] = scrub(v, _nivel + 1)
        return saida
    if isinstance(valor, (list, tuple)):
        return [scrub(v, _nivel + 1) for v in valor]
    if isinstance(valor, str):
        return VALOR_SECRETO.sub(REDIGIDO, valor)
    return valor


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------

app = FastAPI(
    title="EasyPanel Proxy (leitura restrita)",
    version="1.0.0",
    docs_url=None, redoc_url=None, openapi_url=None,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ep-proxy")


class Operador(BaseModel):
    nome: str


async def autenticar(
    authorization: str = Header(default=""),
    x_operador: str = Header(default=""),
) -> Operador:
    if not PROXY_TOKEN_HASH:
        raise HTTPException(503, "proxy nao configurado (PROXY_TOKEN_SHA256 ausente)")
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "faltou Authorization: Bearer <token>")
    if not hmac.compare_digest(
        hashlib.sha256(authorization[7:].encode()).hexdigest(), PROXY_TOKEN_HASH
    ):
        time.sleep(0.5)
        raise HTTPException(401, "token invalido")
    nome = x_operador.strip()
    if not nome or len(nome) > 64:
        raise HTTPException(400, "header X-Operador obrigatorio")
    return Operador(nome=nome)


def trilha(operador: str, procedure: str, resultado: str, detalhe: str = "") -> None:
    """Trilha local em arquivo. Toda chamada, inclusive as recusadas."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    linha = (f"{datetime.now(timezone.utc).isoformat()}\t{operador}\t"
             f"{procedure}\t{resultado}\t{detalhe}\n")
    with (LOG_DIR / "easypanel-proxy.log").open("a", encoding="utf-8") as fh:
        fh.write(linha)


# --------------------------------------------------------------------------
# O unico caminho ate o EasyPanel
# --------------------------------------------------------------------------

def _params_planos(input_: dict) -> list[tuple[str, str]]:
    """Converte o input em query string. Lista vira o mesmo nome repetido."""
    saida: list[tuple[str, str]] = []
    for chave, valor in input_.items():
        if valor is None:
            continue
        if isinstance(valor, (list, tuple)):
            saida.extend((chave, str(v)) for v in valor)
        elif isinstance(valor, bool):
            saida.append((chave, "true" if valor else "false"))
        else:
            saida.append((chave, str(valor)))
    return saida


async def consultar(procedure: str, input_: dict | None, operador: str) -> Any:
    """Chamada de LEITURA ao EasyPanel. Nao existe irma de escrita.

    Nao adianta procurar por uma funcao `mutar()` neste arquivo: ela nao
    existe. Um agente comprometido nao tem como emitir mutation por aqui.
    """
    if procedure in DENYLIST:
        trilha(operador, procedure, "NEGADO", "denylist")
        raise HTTPException(403, f"'{procedure}' bloqueada: devolve credencial")

    if PREFIXO_ESCRITA.match(procedure):
        trilha(operador, procedure, "NEGADO", "prefixo de escrita")
        raise HTTPException(403, f"'{procedure}' parece escrita; o proxy so le")

    if procedure not in ALLOWLIST:
        trilha(operador, procedure, "NEGADO", "fora da allowlist")
        raise HTTPException(
            403,
            f"'{procedure}' nao esta na allowlist. Permitidas: "
            f"{sorted(ALLOWLIST)}",
        )

    if not EASYPANEL_URL or not EASYPANEL_KEY:
        raise HTTPException(503, "proxy sem EASYPANEL_URL/EASYPANEL_API_KEY")

    # A API do EasyPanel e' plana: GET /api/<procedure>?param=valor.
    # O agrupamento que aparece na documentacao (projects/, logs/, metrics/)
    # e' so organizacao das paginas — NAO entra na URL. E nao existe
    # /api/trpc/: tentar por ali devolve 404 em tudo.
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cli:
            r = await cli.get(
                f"{EASYPANEL_URL}/api/{procedure}",
                params=_params_planos(input_ or {}),
                headers={"Authorization": f"Bearer {EASYPANEL_KEY}"},
            )
    except httpx.HTTPError as exc:
        trilha(operador, procedure, "ERRO", type(exc).__name__)
        raise HTTPException(502, f"EasyPanel inalcancavel: {type(exc).__name__}") from exc

    if r.status_code >= 400:
        trilha(operador, procedure, "ERRO", f"http {r.status_code}")
        # nunca devolve o corpo do erro: pode conter eco da chave
        raise HTTPException(502, f"EasyPanel respondeu {r.status_code}")

    trilha(operador, procedure, "OK")
    dados = r.json()
    return scrub(dados)


# --------------------------------------------------------------------------
# Verbos expostos ao agente
# --------------------------------------------------------------------------

@app.get("/v1/panel/status")
async def panel_status(op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """Versao do painel e se ha atualizacao pendente."""
    return {"atualizacao": await consultar("getUpdateStatus", {}, op.nome)}


@app.get("/v1/projects")
async def projetos(op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """Lista os projetos. So nome e data — nao ha servico nem env aqui."""
    return {"projetos": await consultar("listProjects", {}, op.nome)}


# Validado pelo proprio FastAPI: nome fora do padrao vira 422 antes de
# chegar ao proxy. O padrao e' o mesmo que o EasyPanel usa nos schemas dele.
NomeRecurso = Query(pattern=r"^[a-z0-9_-]+$", max_length=64)


@app.get("/v1/service/ports")
async def portas(
    projectName: str = NomeRecurso,
    serviceName: str = NomeRecurso,
    op: Operador = Depends(autenticar),
) -> dict[str, Any]:
    alvo = {"projectName": projectName, "serviceName": serviceName}
    return {"portas": await consultar("listPorts", alvo, op.nome)}


@app.get("/v1/service/mounts")
async def mounts(
    projectName: str = NomeRecurso,
    serviceName: str = NomeRecurso,
    op: Operador = Depends(autenticar),
) -> dict[str, Any]:
    alvo = {"projectName": projectName, "serviceName": serviceName}
    return {"mounts": await consultar("listMounts", alvo, op.nome)}


@app.get("/v1/service/logs")
async def logs_servico(
    projectName: str = NomeRecurso,
    serviceName: str = NomeRecurso,
    limit: int = Query(default=200, ge=1, le=1000),
    stream: str | None = Query(default=None, pattern=r"^(stdout|stderr)$"),
    search: str | None = Query(default=None, max_length=200),
    op: Operador = Depends(autenticar),
) -> dict[str, Any]:
    """Logs de um servico (Loki). O teto de 1000 e' do proprio EasyPanel."""
    alvo = {
        "projectName": projectName,
        "serviceName": serviceName,
        "limit": limit,
        "stream": stream,
        "search": search,
    }
    return {"logs": await consultar("queryServiceLogs", alvo, op.nome)}


@app.get("/v1/service/compose-logs")
async def logs_compose(
    projectName: str = NomeRecurso,
    serviceName: str = NomeRecurso,
    limit: int = Query(default=200, ge=1, le=1000),
    op: Operador = Depends(autenticar),
) -> dict[str, Any]:
    alvo = {"projectName": projectName, "serviceName": serviceName, "limit": limit}
    return {"logs": await consultar("queryComposeServiceLogs", alvo, op.nome)}


@app.get("/v1/service/stats")
async def stats_servico(
    projectName: str = NomeRecurso,
    serviceName: str = NomeRecurso,
    op: Operador = Depends(autenticar),
) -> dict[str, Any]:
    """CPU/memoria de um servico ao longo do tempo (Prometheus)."""
    alvo = {"projectName": projectName, "serviceName": serviceName}
    return {"metricas": await consultar("getMetricsServiceStats", alvo, op.nome)}


@app.get("/v1/stats")
async def stats_gerais(op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """Metricas atuais de todos os servicos, mais as do sistema."""
    return {
        "servicos": await consultar("getAllServicesStats", {}, op.nome),
        "sistema": await consultar("getMetricsSystemStats", {}, op.nome),
    }


@app.get("/v1/service/containers")
async def containers(
    service: str = Query(max_length=128),
    op: Operador = Depends(autenticar),
) -> dict[str, Any]:
    """Containers rodando de um servico. `service` aqui e' o nome completo
    que o Docker usa, nao o par projeto/servico."""
    return {"containers": await consultar("getDockerContainers", {"service": service}, op.nome)}


@app.get("/v1/allowlist")
async def ver_allowlist(op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """O que este proxy sabe fazer. Util para nao ficar tentando no escuro."""
    return {
        "permitidas": {k: v["desc"] for k, v in ALLOWLIST.items()},
        "bloqueadas": sorted(DENYLIST),
        "escrita": "impossivel: nao ha caminho de codigo que emita mutation "
                   "ou destructive neste processo",
        "fora_de_proposito": {
            "inspectProject": "devolve o projeto inteiro, com env dos servicos",
            "inspectAppService": "devolve a config completa, com env",
            "inspectPostgresService": "devolve credenciais do banco",
            "nota": "uteis para diagnostico e justamente por isso vazam. Se "
                    "precisar de um campo especifico, exponha um endpoint que "
                    "projete esse campo em vez de abrir a procedure.",
        },
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "servico": "easypanel-proxy"}


if __name__ == "__main__":
    import sys
    if "--gerar-token" in sys.argv:
        import secrets
        t = secrets.token_urlsafe(48)
        print(f"PROXY_TOKEN={t}\nPROXY_TOKEN_SHA256={hashlib.sha256(t.encode()).hexdigest()}")
        raise SystemExit(0)
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PROXY_PORT", "8778")))
