"""
Admin API — acesso tecnico restrito da assessoria a uma instancia de cliente.

Roda como processo separado DENTRO do container do cliente, numa porta
propria (8777), exposta num subdominio proprio. Nao e' o dashboard, nao fala
com o agente, nao le a conversa do cliente.

Cinco verbos e mais nada:
    GET  /v1/skills                 lista skills instaladas
    POST /v1/skills/install         instala/atualiza skill do catalogo
    GET  /v1/logs                   ultimas linhas dos logs
    GET  /v1/status                 saude da instancia
    POST /v1/credentials            grava credencial no .env do cliente

O que ele NAO faz, de proposito (nao e' backlog, e' a definicao do escopo):
    - conversar com o agente ou disparar qualquer turno
    - ler sessions/ ou memories/  (conversa privada do cliente)
    - ler de volta qualquer segredo ja gravado
    - executar comando arbitrario

Auditoria em platform.admin_audit, com role propria que tem INSERT e nada
mais. Verbo que muda estado NAO executa se a auditoria falhar.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

# --------------------------------------------------------------------------
# Configuracao (tudo por env; nada hardcoded)
# --------------------------------------------------------------------------

DATA_DIR = Path(os.environ.get("HERMES_DATA_DIR", "/opt/data"))
CATALOG_DIR = Path(os.environ.get("PRODUCT_CATALOG_DIR", "/opt/product/skills"))
TENANT_SLUG = os.environ.get("TENANT_SLUG", "")
ADMIN_TOKEN_HASH = os.environ.get("ADMIN_API_TOKEN_SHA256", "")
AUDIT_DSN = os.environ.get("ADMIN_AUDIT_DSN", "")
# "db"   = producao: mutacao sem trilha no Postgres e' RECUSADA (default)
# "file" = dev/teste: trilha em arquivo basta. Nunca use em producao.
AUDIT_MODE = os.environ.get("ADMIN_AUDIT_MODE", "db")
IP_ALLOWLIST = [x.strip() for x in os.environ.get("ADMIN_API_IP_ALLOWLIST", "").split(",") if x.strip()]

# Diretorios que a API pode tocar. Tudo fora disso e' negado por construcao.
SKILLS_DIR = DATA_DIR / "skills"
LOGS_DIR = DATA_DIR / "logs"
ENV_FILE = DATA_DIR / ".env"

# Chaves de credencial que a assessoria pode gravar. Allowlist, nao denylist:
# uma denylist erra por omissao, e o erro aqui e' gravar algo que vira
# execucao de codigo no proximo boot do agente.
CREDENCIAIS_PERMITIDAS = {
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "DEEPSEEK_API_KEY",
    "XAI_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_ALLOWED_USERS",
    "WHATSAPP_ALLOWED_USERS",
    "URBAN_API_TOKEN",
}

SLUG_RE = re.compile(r"^[a-z][a-z0-9_-]{1,63}$")

app = FastAPI(
    title="Hermes White-label — Admin API",
    version="1.0.0",
    docs_url=None,       # sem Swagger publico: a superficie e' documentada fora
    redoc_url=None,
    openapi_url=None,
)


# --------------------------------------------------------------------------
# Autenticacao
# --------------------------------------------------------------------------

class Operador(BaseModel):
    nome: str


def _client_ip(request: Request) -> str:
    # Confia no X-Forwarded-For apenas quando ha allowlist configurada e o
    # proxy e' quem fala com a gente. Sem allowlist, usa o peer direto.
    if IP_ALLOWLIST:
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


async def autenticar(
    request: Request,
    authorization: str = Header(default=""),
    x_operador: str = Header(default=""),
) -> Operador:
    """Bearer token + identidade do operador.

    O token autoriza; o header de operador diz QUEM foi, e vai para a
    auditoria. Auditoria sem nome e' log, nao auditoria — por isso o header
    e' obrigatorio.
    """
    if not ADMIN_TOKEN_HASH:
        # Falha fechada: sem token configurado, a API nao atende ninguem.
        raise HTTPException(503, "admin api nao configurada (ADMIN_API_TOKEN_SHA256 ausente)")

    if IP_ALLOWLIST and _client_ip(request) not in IP_ALLOWLIST:
        raise HTTPException(403, "origem nao autorizada")

    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "faltou Authorization: Bearer <token>")

    apresentado = hashlib.sha256(authorization[7:].encode()).hexdigest()
    if not hmac.compare_digest(apresentado, ADMIN_TOKEN_HASH):
        time.sleep(0.5)  # atrasa forca bruta sem travar uso legitimo
        raise HTTPException(401, "token invalido")

    operador = x_operador.strip()
    if not operador or len(operador) > 64:
        raise HTTPException(400, "header X-Operador obrigatorio (nome de quem opera)")

    return Operador(nome=operador)


# --------------------------------------------------------------------------
# Auditoria
# --------------------------------------------------------------------------

AcaoAudit = Literal["skills.list", "skills.install", "logs.read", "status", "credentials.set"]


def _audit_fallback(registro: dict[str, Any]) -> None:
    linha = json.dumps(registro, ensure_ascii=False, default=str)
    destino = LOGS_DIR / "admin-audit-fallback.jsonl"
    destino.parent.mkdir(parents=True, exist_ok=True)
    with destino.open("a", encoding="utf-8") as fh:
        fh.write(linha + "\n")


def auditar(
    operador: str,
    acao: AcaoAudit,
    detalhe: str,
    resultado: Literal["ok", "erro"],
    erro: str | None = None,
    *,
    obrigatorio: bool,
) -> None:
    """Grava em platform.admin_audit.

    obrigatorio=True (verbos que mudam estado): se nao conseguir gravar,
    levanta — a acao e' recusada. Um install sem trilha e' pior que um
    install que nao aconteceu.
    obrigatorio=False (leituras): cai para arquivo local e segue.
    """
    registro = {
        "ocorrido_em": datetime.now(timezone.utc).isoformat(),
        "operador": operador,
        "tenant_slug": TENANT_SLUG,
        "acao": acao,
        "detalhe": detalhe[:2000],
        "resultado": resultado,
        "erro": (erro or "")[:2000] or None,
    }

    if AUDIT_MODE == "file":
        _audit_fallback(registro)
        return

    try:
        import psycopg  # import tardio: leitura funciona sem o driver
    except ImportError as exc:
        _audit_fallback(registro | {"_falha_audit": f"psycopg ausente: {exc}"})
        if obrigatorio:
            raise HTTPException(503, "auditoria indisponivel (driver); acao recusada")
        return

    if not AUDIT_DSN:
        _audit_fallback(registro | {"_falha_audit": "ADMIN_AUDIT_DSN ausente"})
        if obrigatorio:
            raise HTTPException(503, "auditoria indisponivel (DSN); acao recusada")
        return

    try:
        with psycopg.connect(AUDIT_DSN, connect_timeout=5) as conn:
            conn.execute(
                "INSERT INTO platform.admin_audit "
                "(operador, tenant_slug, acao, detalhe, resultado, erro) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (registro["operador"], registro["tenant_slug"], registro["acao"],
                 registro["detalhe"], registro["resultado"], registro["erro"]),
            )
    except Exception as exc:  # noqa: BLE001 — qualquer falha aqui e' fatal para mutacao
        _audit_fallback(registro | {"_falha_audit": str(exc)})
        if obrigatorio:
            raise HTTPException(503, "auditoria indisponivel; acao recusada") from exc


# --------------------------------------------------------------------------
# Verbo 1 — listar skills
# --------------------------------------------------------------------------

def _ler_versao(skill_dir: Path) -> str | None:
    md = skill_dir / "SKILL.md"
    if not md.is_file():
        return None
    for linha in md.read_text(encoding="utf-8", errors="replace").splitlines()[:30]:
        if linha.startswith("version:"):
            return linha.split(":", 1)[1].strip().strip("\"'")
    return None


@app.get("/v1/skills")
def listar_skills(op: Operador = Depends(autenticar)) -> dict[str, Any]:
    instaladas = []
    if SKILLS_DIR.is_dir():
        for d in sorted(p for p in SKILLS_DIR.rglob("SKILL.md")):
            sd = d.parent
            instaladas.append({
                "nome": sd.name,
                "versao": _ler_versao(sd),
                "caminho": str(sd.relative_to(SKILLS_DIR)),
                "atualizada_em": datetime.fromtimestamp(
                    d.stat().st_mtime, timezone.utc).isoformat(),
            })

    catalogo = sorted(p.parent.name for p in CATALOG_DIR.rglob("SKILL.md")) \
        if CATALOG_DIR.is_dir() else []

    auditar(op.nome, "skills.list", f"{len(instaladas)} instaladas", "ok", obrigatorio=False)
    return {"instaladas": instaladas, "catalogo_disponivel": catalogo}


# --------------------------------------------------------------------------
# Verbo 2 — instalar skill
# --------------------------------------------------------------------------

class InstalarSkill(BaseModel):
    skill: str = Field(min_length=2, max_length=64)

    @field_validator("skill")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not SLUG_RE.match(v):
            raise ValueError("nome de skill invalido")
        return v


@app.post("/v1/skills/install")
def instalar_skill(body: InstalarSkill, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """Copia uma skill DO CATALOGO DO PRODUTO para o volume do cliente.

    A origem e' sempre a arvore assada na imagem. Nao existe upload: skill
    enviada por HTTP e' execucao de codigo arbitrario no agente do cliente
    com outro nome.
    """
    origem = (CATALOG_DIR / body.skill).resolve()
    # dupla checagem: regex no nome + confinamento do caminho resolvido
    # Tentativa recusada nao muda estado: registra, mas nao bloqueia a
    # resposta se a trilha estiver indisponivel.
    if not str(origem).startswith(str(CATALOG_DIR.resolve()) + os.sep):
        auditar(op.nome, "skills.install", body.skill, "erro", "fora do catalogo", obrigatorio=False)
        raise HTTPException(400, "skill fora do catalogo")
    if not (origem / "SKILL.md").is_file():
        auditar(op.nome, "skills.install", body.skill, "erro", "nao existe no catalogo", obrigatorio=False)
        raise HTTPException(404, f"skill '{body.skill}' nao esta no catalogo do produto")

    destino = SKILLS_DIR / body.skill
    ja_existia = destino.exists()

    # auditar ANTES de escrever: se a trilha nao grava, nada acontece
    auditar(op.nome, "skills.install",
            f"{body.skill} ({'atualizacao' if ja_existia else 'instalacao'})",
            "ok", obrigatorio=True)

    destino.parent.mkdir(parents=True, exist_ok=True)
    if ja_existia:
        backup = SKILLS_DIR / f".backup-{body.skill}-{int(time.time())}"
        shutil.move(str(destino), str(backup))
    shutil.copytree(origem, destino)

    return {
        "skill": body.skill,
        "acao": "atualizada" if ja_existia else "instalada",
        "versao": _ler_versao(destino),
        "observacao": "o agente carrega a skill na proxima sessao; nao e' preciso reiniciar",
    }


# --------------------------------------------------------------------------
# Verbo 3 — logs
# --------------------------------------------------------------------------

@app.get("/v1/logs")
def ler_logs(
    arquivo: str = "gateway.log",
    linhas: int = 200,
    op: Operador = Depends(autenticar),
) -> dict[str, Any]:
    linhas = max(1, min(linhas, 2000))

    if "/" in arquivo or "\\" in arquivo or arquivo.startswith("."):
        raise HTTPException(400, "nome de arquivo invalido")
    alvo = (LOGS_DIR / arquivo).resolve()
    # confinado a logs/: sessions/ e memories/ sao inalcancaveis por construcao
    if not str(alvo).startswith(str(LOGS_DIR.resolve()) + os.sep):
        raise HTTPException(400, "caminho fora de logs/")
    if not alvo.is_file():
        disponiveis = sorted(p.name for p in LOGS_DIR.glob("*.log")) if LOGS_DIR.is_dir() else []
        raise HTTPException(404, f"log nao encontrado; disponiveis: {disponiveis}")

    with alvo.open("r", encoding="utf-8", errors="replace") as fh:
        conteudo = fh.readlines()[-linhas:]

    auditar(op.nome, "logs.read", f"{arquivo}:{len(conteudo)}linhas", "ok", obrigatorio=False)
    return {"arquivo": arquivo, "linhas": len(conteudo), "conteudo": "".join(conteudo)}


# --------------------------------------------------------------------------
# Verbo 4 — status
# --------------------------------------------------------------------------

@app.get("/v1/status")
def status(op: Operador = Depends(autenticar)) -> dict[str, Any]:
    def _existe(p: Path) -> bool:
        try:
            return p.exists()
        except OSError:
            return False

    credenciais = {k: bool(_ler_env().get(k)) for k in sorted(CREDENCIAIS_PERMITIDAS)}

    resultado = {
        "tenant": TENANT_SLUG,
        "imagem": os.environ.get("PRODUCT_IMAGE_TAG", "desconhecida"),
        "hermes_versao": _versao_hermes(),
        "volume": {
            "config": _existe(DATA_DIR / "config.yaml"),
            "env": _existe(ENV_FILE),
            "soul": _existe(DATA_DIR / "SOUL.md"),
            "state_db": _existe(DATA_DIR / "state.db"),
            "skills": len(list(SKILLS_DIR.rglob("SKILL.md"))) if SKILLS_DIR.is_dir() else 0,
        },
        # presenca, nunca valor
        "credenciais_configuradas": credenciais,
        "pronta_para_uso": any(
            credenciais.get(k) for k in
            ("OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
             "GOOGLE_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY")
        ),
    }
    auditar(op.nome, "status", "-", "ok", obrigatorio=False)
    return resultado


def _versao_hermes() -> str:
    try:
        out = subprocess.run(
            ["/opt/hermes/.venv/bin/hermes", "--version"],
            capture_output=True, text=True, timeout=15, check=False,
        )
        return (out.stdout or out.stderr).strip()[:120] or "desconhecida"
    except Exception:  # noqa: BLE001
        return "desconhecida"


# --------------------------------------------------------------------------
# Verbo 5 — credenciais (write-only)
# --------------------------------------------------------------------------

class GravarCredenciais(BaseModel):
    credenciais: dict[str, str] = Field(min_length=1)

    @field_validator("credenciais")
    @classmethod
    def _validar(cls, v: dict[str, str]) -> dict[str, str]:
        for chave, valor in v.items():
            if chave not in CREDENCIAIS_PERMITIDAS:
                raise ValueError(f"chave '{chave}' nao permitida")
            if not valor or len(valor) > 4096:
                raise ValueError(f"valor invalido para '{chave}'")
            if "\n" in valor or "\r" in valor:
                # quebra de linha num .env injeta outra variavel
                raise ValueError(f"valor de '{chave}' nao pode conter quebra de linha")
        return v


def _ler_env() -> dict[str, str]:
    if not ENV_FILE.is_file():
        return {}
    saida: dict[str, str] = {}
    for linha in ENV_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        k, _, v = linha.partition("=")
        saida[k.strip()] = v.strip()
    return saida


@app.post("/v1/credentials")
def gravar_credenciais(
    body: GravarCredenciais, op: Operador = Depends(autenticar)
) -> dict[str, Any]:
    """Grava credenciais no .env do cliente. NUNCA le de volta.

    A resposta diz quais chaves foram gravadas, nunca os valores. Se alguem
    comprometer o token da admin API, ganha a capacidade de SOBRESCREVER
    credenciais — nao a de exfiltrar as que ja estavam la.
    """
    chaves = sorted(body.credenciais)
    auditar(op.nome, "credentials.set", ",".join(chaves), "ok", obrigatorio=True)

    atual = _ler_env()
    novas = {k: v for k, v in body.credenciais.items() if k not in atual}
    atual.update(body.credenciais)

    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = ENV_FILE.with_suffix(".env.tmp")
    conteudo = "\n".join(f"{k}={v}" for k, v in sorted(atual.items())) + "\n"
    tmp.write_text(conteudo, encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, ENV_FILE)   # atomico: nunca ha .env pela metade

    return {
        "gravadas": chaves,
        "novas": sorted(novas),
        "sobrescritas": sorted(set(chaves) - set(novas)),
        "observacao": "reinicie a instancia para o gateway reler o .env",
    }


# --------------------------------------------------------------------------
# Health (sem auth — so diz que o processo esta de pe)
# --------------------------------------------------------------------------

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "tenant": TENANT_SLUG}


def gerar_token() -> tuple[str, str]:
    """Helper de provisionamento: devolve (token, sha256). O token nao e'
    guardado em lugar nenhum pela plataforma — vai para o cofre da equipe."""
    token = secrets.token_urlsafe(48)
    return token, hashlib.sha256(token.encode()).hexdigest()


if __name__ == "__main__":
    import sys
    if "--gerar-token" in sys.argv:
        t, h = gerar_token()
        print(f"ADMIN_API_TOKEN={t}\nADMIN_API_TOKEN_SHA256={h}")
        raise SystemExit(0)
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("ADMIN_API_PORT", "8777")))
