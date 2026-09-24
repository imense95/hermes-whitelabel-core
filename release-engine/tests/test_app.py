"""
Testes da camada HTTP do release engine. TestClient + executor fake + RepoMemoria.
Cobrem: auth, classificacao no POST, o fluxo apply->confirm, apply->revert,
o gate 'manual', a reversao automatica quando health falha, e a linguagem de
negocio nas mensagens (sem jargao tecnico).
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

TOKEN = "release-token-teste-123456"
OPERADOR = "herbert@assessoria"


@pytest.fixture()
def cli(monkeypatch):
    monkeypatch.setenv("RELEASE_API_TOKEN_SHA256", hashlib.sha256(TOKEN.encode()).hexdigest())
    monkeypatch.setenv("RELEASE_TELEGRAM_BOT_TOKEN", "")   # notificacao silenciosa
    monkeypatch.delenv("RELEASE_DSN", raising=False)       # forca RepoMemoria
    for mod in ("app",):
        sys.modules.pop(mod, None)
    import app as mod  # noqa: PLC0415
    mod.REPO = mod.repo_mod.RepoMemoria()
    mod.EXECUTORES = mod.RegistroExecutores()
    return TestClient(mod.app), mod


def h(extra=None):
    base = {"Authorization": f"Bearer {TOKEN}", "X-Operador": OPERADOR}
    base.update(extra or {})
    return base


class ExecutorFake:
    def __init__(self, health=True):
        self.chamadas = []
        self._health = health

    def como_executor(self, mod):
        return mod.m.Executor(self._backup, self._aplicar, self._verificar, self._reverter)

    def _backup(self):
        self.chamadas.append("backup"); return "bk-1"

    def _aplicar(self):
        self.chamadas.append("aplicar")

    def _verificar(self):
        self.chamadas.append("verificar"); return self._health

    def _reverter(self, ref):
        self.chamadas.append(f"reverter({ref})")


def _plugar_executor(mod, rid, fake):
    """Substitui o montar() do registro para devolver o fake desta release."""
    ex = fake.como_executor(mod)

    def _montar(rel):
        wrapped = mod.EXECUTORES._wrap(rel, ex)
        mod.EXECUTORES._por_release[rel.id] = wrapped
        return wrapped
    mod.EXECUTORES.montar = _montar


# --- auth -----------------------------------------------------------------

def test_sem_token_nega(cli):
    c, _ = cli
    assert c.get("/v1/releases").status_code == 401


def test_sem_operador_nega(cli):
    c, _ = cli
    assert c.get("/v1/releases", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 400


def test_health_publico(cli):
    c, _ = cli
    assert c.get("/health").status_code == 200


# --- classificacao no POST ------------------------------------------------

def test_cria_migracao_aditiva_como_auto(cli):
    c, _ = cli
    r = c.post("/v1/releases", json={
        "tipo": "migracao", "alvo": "urban", "descricao": "Nova area de skills",
        "sql": "CREATE TABLE x(a int); ALTER TABLE x ADD COLUMN b text;"}, headers=h())
    assert r.status_code == 200
    assert r.json()["classe"] == "auto"
    assert r.json()["pode_auto_aplicar"] is True


def test_cria_migracao_destrutiva_como_manual(cli):
    c, _ = cli
    r = c.post("/v1/releases", json={
        "tipo": "migracao", "alvo": "urban", "descricao": "Remocao",
        "sql": "DROP TABLE x;"}, headers=h())
    assert r.json()["classe"] == "manual"
    assert r.json()["pode_auto_aplicar"] is False
    assert any("DROP" in mo for mo in r.json()["motivos"])


def test_migracao_sem_sql_nega(cli):
    c, _ = cli
    r = c.post("/v1/releases", json={"tipo": "migracao", "alvo": "urban",
                                     "descricao": "x"}, headers=h())
    assert r.status_code == 400


def test_imagem_e_sempre_auto(cli):
    c, _ = cli
    r = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                     "descricao": "Nova versao do app"}, headers=h())
    assert r.json()["classe"] == "auto"
    # sem relogio: nada de janela_seg na resposta
    assert "janela_seg" not in r.json()
    assert "deadline" not in r.json()


# --- fluxo apply -> confirm -----------------------------------------------

def test_apply_entra_em_provisoria_sem_prazo_e_confirm_consolida(cli):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                       "descricao": "deploy"}, headers=h()).json()["id"]
    fake = ExecutorFake()
    _plugar_executor(mod, rid, fake)

    r2 = c.post(f"/v1/releases/{rid}/apply", headers=h())
    assert r2.status_code == 200
    assert r2.json()["estado"] == "provisoria"
    assert r2.json()["aguardando_desde"] is not None
    assert "segundos_restantes" not in r2.json()   # sem relogio

    r3 = c.post(f"/v1/releases/{rid}/confirm", headers=h())
    assert r3.json()["estado"] == "consolidada"
    assert r3.json()["confirmada_por"] == OPERADOR
    assert not any("reverter" in x for x in fake.chamadas)


def test_apply_health_falho_reverte(cli):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                       "descricao": "deploy"}, headers=h()).json()["id"]
    fake = ExecutorFake(health=False)
    _plugar_executor(mod, rid, fake)
    r = c.post(f"/v1/releases/{rid}/apply", headers=h())
    assert r.json()["estado"] == "revertida"
    assert r.json()["reverter_motivo"] == "health"
    assert "reverter(bk-1)" in fake.chamadas


def test_apply_manual_e_recusado_com_linguagem_de_negocio(cli):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "migracao", "alvo": "urban",
                                       "descricao": "Remocao", "sql": "DROP TABLE x;"},
                 headers=h()).json()["id"]
    r = c.post(f"/v1/releases/{rid}/apply", headers=h())
    assert r.status_code == 409
    # mensagem sem jargao: nao fala 'expand/contract' cru pro operador
    assert "tratamento manual" in r.json()["detail"]


def test_apply_duas_vezes_recusa(cli):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                       "descricao": "d"}, headers=h()).json()["id"]
    _plugar_executor(mod, rid, ExecutorFake())
    c.post(f"/v1/releases/{rid}/apply", headers=h())
    r = c.post(f"/v1/releases/{rid}/apply", headers=h())
    assert r.status_code == 409


def test_revert_humano(cli):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                       "descricao": "d"}, headers=h()).json()["id"]
    fake = ExecutorFake()
    _plugar_executor(mod, rid, fake)
    c.post(f"/v1/releases/{rid}/apply", headers=h())
    r = c.post(f"/v1/releases/{rid}/revert", headers=h())
    assert r.json()["estado"] == "revertida"
    assert r.json()["reverter_motivo"] == "humano"
    assert "reverter(bk-1)" in fake.chamadas


# --- persistencia dos eventos na trilha -----------------------------------

def test_trilha_de_eventos_cresce_a_cada_transicao(cli):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                       "descricao": "d"}, headers=h()).json()["id"]
    _plugar_executor(mod, rid, ExecutorFake())
    c.post(f"/v1/releases/{rid}/apply", headers=h())
    r = c.get(f"/v1/releases/{rid}", headers=h())
    estados = [e["para"] for e in r.json()["eventos"]]
    assert estados == ["backup", "aplicando", "verificando", "provisoria"]


# --- mensagem de notificacao usa linguagem de negocio ---------------------

def test_msg_aguardando_nao_tem_jargao(cli):
    c, mod = cli
    rel = mod.m.Release(id=9, tipo="migracao", alvo="urban", classe="auto",
                        descricao="Nova area de skills")
    msg = mod._msg_aguardando(rel)
    for jargao in ("schema", "tag", "deadline", "sha-", "pg_dump", "psql"):
        assert jargao not in msg.lower()
    assert "aprova" in msg.lower()


def test_link_telegram_aponta_para_pagina_da_mudanca(cli, monkeypatch):
    # O link da notificacao vai direto para a pagina da mudanca no painel
    # (rota amigavel /mudancas/, nao a rota interna /releases/ da API).
    c, mod = cli
    monkeypatch.setattr(mod, "PANEL_BASE_URL", "https://painel.exemplo")
    assert mod._link(42) == "https://painel.exemplo/mudancas/42"
    assert "/releases/" not in mod._link(42)
