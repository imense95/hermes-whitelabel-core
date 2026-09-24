"""
Release engine — API central da assessoria (servico novo, fora dos containers).

Aplicacao segura com APROVACAO HUMANA (sem relogio). Expoe a maquina de estados
por HTTP para a pagina do painel:
    POST /v1/releases              cria uma release (classifica; auto|manual)
    POST /v1/releases/{id}/apply   aplica (backup->aplica->verifica->provisoria)
    POST /v1/releases/{id}/confirm humano aprova -> consolida
    POST /v1/releases/{id}/revert  humano reverte
    GET  /v1/releases/{id}         estado ao vivo (para a pagina)
    GET  /v1/releases              lista
    POST /v1/primeira-carga        aplica a carga inicial (04+05) com backup

NAO ha relogio de auto-reversao: uma release aplicada com sucesso fica
'provisoria' aguardando aprovacao humana, sem prazo. So acao humana a move.
A unica reversao automatica e' quando aplicar/verificar falha (a mudanca nao
subiu) -> volta ao backup na hora.

Este processo detem a chave de deploy (deployer, opcao A) e a DSN de
superusuario. NAO e' exposto ao agente: so a UI do painel o chama, atras do
mesmo Keycloak. Toda mutacao exige Bearer + X-Operador (auditavel).

Persistencia: RepoPostgres (platform.release) quando RELEASE_DSN esta setado;
RepoMemoria como fallback dev/teste. Os executores concretos por release sao
montados pelo RegistroExecutores a partir do ambiente do processo — nenhum
segredo passa por parametro de API.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

import maquina as m
import repo as repo_mod
from classificador import classificar_migracao
from executores import ExecutorBanco, ExecutorImagem

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
PANEL_TOKEN_HASH = os.environ.get("RELEASE_API_TOKEN_SHA256", "")
TELEGRAM_BOT_TOKEN = os.environ.get("RELEASE_TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("RELEASE_TELEGRAM_CHAT_ID", "")
PANEL_BASE_URL = os.environ.get("RELEASE_PANEL_BASE_URL", "").rstrip("/")

RELEASE_DSN = os.environ.get("RELEASE_DSN", "")          # superusuario; vazio=memoria
INIT_SQL_DIR = Path(os.environ.get("RELEASE_INIT_SQL_DIR", "/opt/product/infra/db/init"))
PLATAFORMA_SCHEMA = os.environ.get("RELEASE_PLATFORM_SCHEMA", "platform")

app = FastAPI(title="Release Engine", version="2.0.0",
              docs_url=None, redoc_url=None, openapi_url=None)


# --------------------------------------------------------------------------
# Repositorio: Postgres em producao, memoria em dev/teste
# --------------------------------------------------------------------------
def _construir_repo() -> repo_mod.Repo:
    if RELEASE_DSN:
        import psycopg  # import tardio: so exige o driver quando ha DSN

        def conectar():
            return psycopg.connect(RELEASE_DSN)

        return repo_mod.RepoPostgres(conectar)
    return repo_mod.RepoMemoria()


REPO: repo_mod.Repo = _construir_repo()


# --------------------------------------------------------------------------
# Registro de executores: monta o ator concreto de cada release a partir do
# AMBIENTE (nunca de parametro de API). Guardado por release_id em runtime.
# --------------------------------------------------------------------------
class RegistroExecutores:
    def __init__(self) -> None:
        self._por_release: dict[int, m.Executor] = {}

    def _wrap(self, rel: m.Release, ex) -> m.Executor:
        """Embrulha fazer_backup para gravar o backup_ref na release assim que sai."""
        orig = ex.fazer_backup

        def _backup():
            ref = orig()
            rel.backup_ref = ref
            return ref

        return m.Executor(_backup, ex.aplicar, ex.verificar_saude, ex.reverter)

    def montar(self, rel: m.Release) -> m.Executor:
        if rel.tipo == "migracao":
            dsn = os.environ.get("RELEASE_DSN", "")
            if not dsn:
                raise HTTPException(409, "release engine sem conexao de banco configurada")
            sql_path = Path(rel.payload_ref) if rel.payload_ref else None
            if not sql_path or not sql_path.exists():
                raise HTTPException(409, "arquivo da migracao nao encontrado no servidor")
            health_dsn = os.environ.get("RELEASE_HEALTH_DSN") or None
            ex = ExecutorBanco(dsn=dsn, schema=rel.alvo, sql_path=sql_path,
                               health_dsn=health_dsn)
        else:  # imagem
            projeto = os.environ.get("DEPLOYER_PROJETO", "")
            tag_nova = rel.payload_ref or ""
            tag_atual = os.environ.get(f"DEPLOYER_TAG_ATUAL_{rel.alvo}", "")
            health_url = os.environ.get(f"DEPLOYER_HEALTH_URL_{rel.alvo}", "")
            ex = ExecutorImagem(projeto=projeto, servico=rel.alvo, tag_nova=tag_nova,
                                tag_atual=tag_atual, health_url=health_url)
        wrapped = self._wrap(rel, ex)
        self._por_release[rel.id] = wrapped
        return wrapped

    def get(self, rel: m.Release) -> m.Executor:
        ex = self._por_release.get(rel.id)
        if ex is None:
            ex = self.montar(rel)
        return ex


EXECUTORES = RegistroExecutores()


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
class Operador(BaseModel):
    nome: str


async def autenticar(authorization: str = Header(default=""),
                     x_operador: str = Header(default="")) -> Operador:
    if not PANEL_TOKEN_HASH:
        raise HTTPException(503, "release engine nao configurado (RELEASE_API_TOKEN_SHA256)")
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "faltou Authorization: Bearer ***")
    if not hmac.compare_digest(
            hashlib.sha256(authorization[7:].encode()).hexdigest(), PANEL_TOKEN_HASH):
        time.sleep(0.5)
        raise HTTPException(401, "token invalido")
    nome = x_operador.strip()
    if not nome or len(nome) > 64:
        raise HTTPException(400, "header X-Operador obrigatorio")
    return Operador(nome=nome)


# --------------------------------------------------------------------------
# Notificacao Telegram (quando entra em provisoria = aguardando aprovacao)
# --------------------------------------------------------------------------
async def notificar_telegram(texto: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            await cli.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_CHAT_ID, "text": texto,
                      "parse_mode": "HTML", "disable_web_page_preview": True},
            )
    except httpx.HTTPError:
        pass


def _link(rid: int) -> str:
    # Aponta para a pagina da mudanca no painel (rota amigavel, sem jargao).
    return f"{PANEL_BASE_URL}/mudancas/{rid}" if PANEL_BASE_URL else f"(painel)/mudancas/{rid}"


def _msg_aguardando(rel: m.Release) -> str:
    # linguagem de negocio: nada de 'schema', 'tag', 'deadline'
    return (f"\u2705 <b>Mudanca aplicada e aguardando sua aprovacao</b>\n"
            f"{rel.descricao}\n"
            f"Nada muda em definitivo ate voce aprovar. Se preferir desfazer, "
            f"e' um clique.\n"
            f"Abrir: {_link(rel.id)}")


# --------------------------------------------------------------------------
# Serializacao para a API (a pagina do painel consome isto)
# --------------------------------------------------------------------------
def _rel_json(rel: m.Release) -> dict[str, Any]:
    return {
        "id": rel.id, "tipo": rel.tipo, "alvo": rel.alvo, "classe": rel.classe,
        "descricao": rel.descricao, "estado": rel.estado, "health_ok": rel.health_ok,
        "aguardando_desde": rel.aguardando_desde.isoformat() if rel.aguardando_desde else None,
        "solicitada_por": rel.solicitada_por,
        "confirmada_por": rel.confirmada_por,
        "reverter_motivo": rel.reverter_motivo,
        "eventos": [{"para": e[0], "ator": e[1], "detalhe": e[2]} for e in rel.eventos],
    }


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
class CriarRelease(BaseModel):
    tipo: str = Field(pattern=r"^(migracao|imagem)$")
    alvo: str = Field(min_length=1, max_length=128)
    descricao: str = Field(min_length=1, max_length=500)
    sql: str | None = None          # migracao: usado para classificar
    payload_ref: str | None = None  # migracao: caminho do .sql; imagem: tag nova

    model_config = {"extra": "forbid"}


@app.post("/v1/releases")
def criar_release(body: CriarRelease, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """Cria uma release e a classifica pela taxonomia.

    migracao: classifica o SQL. 'manual' (destrutivo) NAO entra no fluxo
    automatico. 'auto' pode seguir para /apply.
    imagem: sempre auto-elegivel (reverter e' lossless).
    """
    if body.tipo == "migracao":
        if not body.sql:
            raise HTTPException(400, "migracao exige o campo 'sql' para classificar")
        try:
            c = classificar_migracao(body.sql)
        except ValueError as e:
            raise HTTPException(400, str(e))
        classe, motivos, avisos = c.classe, c.motivos, c.avisos
    else:
        classe, motivos, avisos = "auto", [], []

    rel = REPO.criar(tipo=body.tipo, alvo=body.alvo, classe=classe,
                     descricao=body.descricao, solicitada_por=op.nome,
                     motivos=motivos, avisos=avisos, payload_ref=body.payload_ref)
    REPO.salvar(rel)
    return {**_rel_json(rel), "motivos": motivos, "avisos": avisos,
            "pode_auto_aplicar": classe == "auto"}


@app.post("/v1/releases/{rid}/apply")
async def aplicar_release(rid: int, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """Aplica: backup -> aplica -> verifica -> provisoria (ou reverte se falhar)."""
    rel = REPO.get(rid)
    if rel is None:
        raise HTTPException(404, "release nao existe")
    if rel.estado != m.SOLICITADA:
        raise HTTPException(409, f"release ja esta em '{rel.estado}', nao da' para aplicar")
    if rel.classe == "manual":
        raise HTTPException(409, "esta mudanca precisa de tratamento manual em etapas; "
                                 "nao entra no fluxo automatico")

    executor = EXECUTORES.montar(rel)
    m.iniciar(rel, executor, ator=op.nome)
    REPO.salvar(rel)
    if rel.estado == m.PROVISORIA:
        await notificar_telegram(_msg_aguardando(rel))
    return _rel_json(rel)


@app.post("/v1/releases/{rid}/confirm")
def confirmar_release(rid: int, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    rel = REPO.get(rid)
    if rel is None:
        raise HTTPException(404, "release nao existe")
    try:
        m.confirmar(rel, operador=op.nome)
    except m.TransicaoInvalida:
        raise HTTPException(409, "esta mudanca nao esta aguardando aprovacao")
    REPO.salvar(rel)
    return _rel_json(rel)


@app.post("/v1/releases/{rid}/revert")
def reverter_release(rid: int, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    rel = REPO.get(rid)
    if rel is None:
        raise HTTPException(404, "release nao existe")
    executor = EXECUTORES.get(rel)
    try:
        m.reverter(rel, executor, rel.backup_ref or "", ator=op.nome, motivo="humano")
    except m.TransicaoInvalida:
        raise HTTPException(409, "esta mudanca nao pode ser desfeita neste estado")
    REPO.salvar(rel)
    return _rel_json(rel)


@app.get("/v1/releases/{rid}")
def ver_release(rid: int, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    rel = REPO.get(rid)
    if rel is None:
        raise HTTPException(404, "release nao existe")
    return _rel_json(rel)


@app.get("/v1/releases")
def listar_releases(op: Operador = Depends(autenticar)) -> dict[str, Any]:
    return {"releases": [_rel_json(r) for r in REPO.listar()]}


# --------------------------------------------------------------------------
# Primeira carga: aplica 04+05 (o ovo e a galinha). Botao no painel, com backup.
# --------------------------------------------------------------------------
@app.post("/v1/primeira-carga")
def primeira_carga(op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """Aplica a carga inicial do painel (as tabelas de skills e de releases).

    E' o unico caminho que NAO passa pelo canary por definicao: cria a propria
    tabela que o canary usa. Aplica os arquivos em ordem, uma transacao por
    arquivo. Idempotente: os arquivos usam CREATE TABLE IF NOT EXISTS.
    """
    dsn = os.environ.get("RELEASE_DSN", "")
    if not dsn:
        raise HTTPException(409, "release engine sem conexao de banco configurada")
    import psycopg  # noqa: PLC0415

    arquivos = [INIT_SQL_DIR / "04-skills-registry-prod.sql",
                INIT_SQL_DIR / "05-release-engine-prod.sql"]
    faltando = [a.name for a in arquivos if not a.exists()]
    if faltando:
        raise HTTPException(409, "arquivos da primeira carga nao encontrados no servidor")

    aplicados: list[str] = []
    with psycopg.connect(dsn) as con:
        with con.cursor() as cur:
            cur.execute(f"CREATE SCHEMA IF NOT EXISTS {PLATAFORMA_SCHEMA}")
        con.commit()
        for arq in arquivos:
            sql = arq.read_text(encoding="utf-8")
            with con.cursor() as cur:
                cur.execute(sql)
            con.commit()
            aplicados.append(arq.name)
    return {"ok": True, "aplicados": aplicados,
            "mensagem": "Base do painel criada. Voce ja pode gerenciar skills."}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "servico": "release-engine"}


@app.get("/v1/base/status")
def base_status(op: Operador = Depends(autenticar)) -> dict[str, bool]:
    """A base do painel ja existe? A tela de primeira carga usa isto para decidir
    se mostra o botao de criar a base ou ja segue para a operacao normal.

    'pronta' = a tabela platform.release existe e responde. Sem DSN (dev), a
    base em memoria esta sempre pronta.
    """
    dsn = os.environ.get("RELEASE_DSN", "")
    if not dsn:
        return {"pronta": True}
    import psycopg  # noqa: PLC0415
    try:
        with psycopg.connect(dsn) as con, con.cursor() as cur:
            cur.execute("SELECT to_regclass('platform.release') IS NOT NULL")
            (existe,) = cur.fetchone()
        return {"pronta": bool(existe)}
    except Exception:  # noqa: BLE001 — banco fora do ar = base nao pronta
        return {"pronta": False}


if __name__ == "__main__":
    import sys
    if "--gerar-token" in sys.argv:
        import secrets
        t = secrets.token_urlsafe(48)
        print(f"RELEASE_API_TOKEN={t}\nRELEASE_API_TOKEN_SHA256={hashlib.sha256(t.encode()).hexdigest()}")
        raise SystemExit(0)
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("RELEASE_PORT", "8779")))
