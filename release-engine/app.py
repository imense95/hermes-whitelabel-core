"""
Release engine — API central da assessoria (servico novo, fora dos containers).

Expoe a maquina de estados por HTTP para a pagina do painel:
    POST /v1/releases              cria uma release (classifica; auto|manual)
    POST /v1/releases/{id}/apply   aplica (backup->aplica->health->provisoria)
    POST /v1/releases/{id}/confirm humano confirma dentro da janela -> consolida
    POST /v1/releases/{id}/revert  humano reverte agora
    GET  /v1/releases/{id}         estado ao vivo (para a pagina + relogio)
    GET  /v1/releases              lista

E roda o RECONCILIADOR em background: o relogio e' server-side, entao mesmo
sem ninguem com a pagina aberta, uma release provisoria que passa do deadline
e' revertida sozinha e o humano e' avisado por Telegram.

Este processo detem a chave de deploy (deployer, opcao A) e a DSN de
superusuario. NAO e' exposto ao agente: so a UI do painel o chama, atras do
mesmo Keycloak. Toda mutacao exige Bearer + X-Operador (auditavel).

NOTA: a persistencia real (platform.release via psycopg) e o wiring dos
executores concretos por release entram no PR de integracao com o banco. Aqui
esta a superficie HTTP, a maquina, a classificacao e a notificacao — tudo
testavel sem Postgres. O estado vive num repositorio em memoria com a mesma
interface que o repositorio Postgres tera.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import time
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

import maquina as m
from classificador import classificar_migracao

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
PANEL_TOKEN_HASH = os.environ.get("RELEASE_API_TOKEN_SHA256", "")
TELEGRAM_BOT_TOKEN = os.environ.get("RELEASE_TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("RELEASE_TELEGRAM_CHAT_ID", "")
PANEL_BASE_URL = os.environ.get("RELEASE_PANEL_BASE_URL", "").rstrip("/")
RECONCILE_SEG = int(os.environ.get("RELEASE_RECONCILE_INTERVAL", "15"))

# janelas padrao (regra do projeto)
JANELA_IMAGEM = int(os.environ.get("RELEASE_JANELA_IMAGEM", str(30 * 60)))       # 30 min
JANELA_MIGRACAO = int(os.environ.get("RELEASE_JANELA_MIGRACAO", str(6 * 3600)))  # 6h

app = FastAPI(title="Release Engine", version="1.0.0",
              docs_url=None, redoc_url=None, openapi_url=None)


# --------------------------------------------------------------------------
# Repositorio (em memoria; a versao Postgres implementa a mesma interface)
# --------------------------------------------------------------------------
class RepoMemoria:
    def __init__(self):
        self._rel: dict[int, m.Release] = {}
        self._backup_ref: dict[int, str] = {}
        self._exec: dict[int, m.Executor] = {}
        self._seq = 0

    def criar(self, tipo, alvo, classe, janela_seg) -> m.Release:
        self._seq += 1
        rel = m.Release(id=self._seq, tipo=tipo, alvo=alvo, classe=classe, janela_seg=janela_seg)
        self._rel[rel.id] = rel
        return rel

    def get(self, rid: int) -> m.Release | None:
        return self._rel.get(rid)

    def listar(self) -> list[m.Release]:
        return list(self._rel.values())

    def set_exec(self, rid: int, executor: m.Executor, backup_ref: str = ""):
        self._exec[rid] = executor
        if backup_ref:
            self._backup_ref[rid] = backup_ref

    def executor(self, rid: int) -> m.Executor | None:
        return self._exec.get(rid)

    def backup_ref(self, rid: int) -> str:
        return self._backup_ref.get(rid, "")

    def set_backup_ref(self, rid: int, ref: str):
        self._backup_ref[rid] = ref


REPO = RepoMemoria()


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
# Notificacao Telegram (quando entra em provisoria e quando auto-reverte)
# --------------------------------------------------------------------------
async def notificar_telegram(texto: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return  # sem canal configurado: silencioso (dev)
    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            await cli.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_CHAT_ID, "text": texto,
                      "parse_mode": "HTML", "disable_web_page_preview": True},
            )
    except httpx.HTTPError:
        pass  # a notificacao nao pode derrubar o reconciliador


def _link(rid: int) -> str:
    return f"{PANEL_BASE_URL}/releases/{rid}" if PANEL_BASE_URL else f"(painel)/releases/{rid}"


def _msg_provisoria(rel: m.Release) -> str:
    mins = rel.janela_seg // 60
    return (f"🕒 <b>Release {rel.id} em janela de confirmacao</b>\n"
            f"{rel.tipo} · {rel.alvo}\n"
            f"Reverte sozinha em {mins} min se voce nao confirmar.\n"
            f"Abrir: {_link(rel.id)}")


def _msg_revertida(rel: m.Release) -> str:
    return (f"↩️ <b>Release {rel.id} revertida automaticamente</b>\n"
            f"{rel.tipo} · {rel.alvo} — sem confirmacao ate o prazo.\n"
            f"Estado restaurado do backup. {_link(rel.id)}")


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
class CriarRelease(BaseModel):
    tipo: str = Field(pattern=r"^(migracao|imagem)$")
    alvo: str = Field(min_length=1, max_length=128)
    descricao: str = Field(min_length=1, max_length=500)
    sql: str | None = None        # p/ migracao: usado para classificar

    model_config = {"extra": "forbid"}


def _rel_json(rel: m.Release) -> dict[str, Any]:
    return {
        "id": rel.id, "tipo": rel.tipo, "alvo": rel.alvo, "classe": rel.classe,
        "estado": rel.estado, "health_ok": rel.health_ok,
        "janela_seg": rel.janela_seg,
        "deadline": rel.deadline.isoformat() if rel.deadline else None,
        "segundos_restantes": rel.segundos_restantes(),
        "confirmada_por": rel.confirmada_por,
        "reverter_motivo": rel.reverter_motivo,
        "eventos": [{"para": e[0], "ator": e[1], "detalhe": e[2]} for e in rel.eventos],
    }


@app.post("/v1/releases")
def criar_release(body: CriarRelease, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """Cria uma release e a classifica pela taxonomia.

    migracao: classifica o SQL. 'manual' (destrutivo) NAO entra no fluxo
    automatico — a resposta diz os motivos e o estado fica 'solicitada' aguardando
    tratamento por expand/contract. 'auto' pode seguir para /apply.
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
        janela = JANELA_MIGRACAO
    else:
        classe, motivos, avisos = "auto", [], []
        janela = JANELA_IMAGEM

    rel = REPO.criar(body.tipo, body.alvo, classe, janela)
    return {**_rel_json(rel), "motivos": motivos, "avisos": avisos,
            "pode_auto_aplicar": classe == "auto"}


@app.post("/v1/releases/{rid}/apply")
async def aplicar_release(rid: int, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """Aplica: backup -> aplica -> health -> provisoria (ou auto-reverte)."""
    rel = REPO.get(rid)
    if rel is None:
        raise HTTPException(404, "release nao existe")
    if rel.classe == "manual":
        raise HTTPException(409, "release 'manual' exige tratamento por expand/contract; "
                                 "nao entra no fluxo automatico")
    executor = REPO.executor(rid)
    if executor is None:
        raise HTTPException(409, "release sem executor configurado (wiring do PR de integracao)")

    # captura o backup_ref que o executor gera, para o reconciliador poder reverter
    orig_backup = executor.fazer_backup
    def _wrap_backup():
        ref = orig_backup()
        REPO.set_backup_ref(rid, ref)
        return ref
    executor.fazer_backup = _wrap_backup  # type: ignore[attr-defined]

    estado = m.iniciar(rel, executor, ator=op.nome)
    if estado == m.PROVISORIA:
        await notificar_telegram(_msg_provisoria(rel))
    return _rel_json(rel)


@app.post("/v1/releases/{rid}/confirm")
def confirmar_release(rid: int, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    rel = REPO.get(rid)
    if rel is None:
        raise HTTPException(404, "release nao existe")
    executor = REPO.executor(rid)
    if executor is None:
        raise HTTPException(409, "release sem executor configurado")
    try:
        m.confirmar(rel, executor, operador=op.nome)
    except m.TransicaoInvalida as e:
        raise HTTPException(409, str(e))
    return _rel_json(rel)


@app.post("/v1/releases/{rid}/revert")
def reverter_release(rid: int, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    rel = REPO.get(rid)
    if rel is None:
        raise HTTPException(404, "release nao existe")
    executor = REPO.executor(rid)
    if executor is None:
        raise HTTPException(409, "release sem executor configurado")
    try:
        m.reverter(rel, executor, REPO.backup_ref(rid), ator=op.nome, motivo="humano")
    except m.TransicaoInvalida as e:
        raise HTTPException(409, str(e))
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "servico": "release-engine"}


# --------------------------------------------------------------------------
# Reconciliador: o relogio server-side. Padrao seguro = reverter.
# --------------------------------------------------------------------------
async def _tick_reconciliador() -> None:
    """Uma passada: reverte toda release provisoria expirada. Idempotente."""
    for rel in REPO.listar():
        if rel.expirada():
            executor = REPO.executor(rel.id)
            if executor is None:
                continue
            m.reconciliar(rel, executor, REPO.backup_ref(rel.id))
            if rel.estado == m.REVERTIDA:
                await notificar_telegram(_msg_revertida(rel))


async def _loop_reconciliador() -> None:
    while True:
        try:
            await _tick_reconciliador()
        except Exception:  # noqa: BLE001 — o loop nunca morre por um erro pontual
            pass
        await asyncio.sleep(RECONCILE_SEG)


from contextlib import asynccontextmanager  # noqa: E402


@asynccontextmanager
async def lifespan(app_: FastAPI):
    # so liga o loop se nao estivermos sob teste (os testes chamam _tick direto)
    tarefa = None
    if os.environ.get("RELEASE_NO_BACKGROUND") != "1":
        tarefa = asyncio.create_task(_loop_reconciliador())
    yield
    if tarefa:
        tarefa.cancel()


app.router.lifespan_context = lifespan


if __name__ == "__main__":
    import sys
    if "--gerar-token" in sys.argv:
        import secrets
        t = secrets.token_urlsafe(48)
        print(f"RELEASE_API_TOKEN={t}\nRELEASE_API_TOKEN_SHA256={hashlib.sha256(t.encode()).hexdigest()}")
        raise SystemExit(0)
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("RELEASE_PORT", "8779")))
