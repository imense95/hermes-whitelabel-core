"""
Testes da camada HTTP do release engine. TestClient + executor fake.
Cobrem: auth, classificacao no POST, o fluxo apply->confirm, apply->revert,
o gate 'manual', e o reconciliador via _tick direto (sem background real).
"""
from __future__ import annotations

import hashlib
import os
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

TOKEN = "release-token-teste-123456"
OPERADOR = "herbert@assessoria"


@pytest.fixture()
def cli(monkeypatch):
    monkeypatch.setenv("RELEASE_API_TOKEN_SHA256", hashlib.sha256(TOKEN.encode()).hexdigest())
    monkeypatch.setenv("RELEASE_NO_BACKGROUND", "1")   # sem loop; chamamos _tick
    monkeypatch.setenv("RELEASE_TELEGRAM_BOT_TOKEN", "")   # notificacao silenciosa
    for mod in [k for k in list(sys.modules) if k in ("app",)]:
        del sys.modules[mod]
    import app as mod  # noqa: PLC0415
    # zera o repo entre testes
    mod.REPO = mod.RepoMemoria()
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
        "tipo": "migracao", "alvo": "urban", "descricao": "add tabela",
        "sql": "CREATE TABLE x(a int); ALTER TABLE x ADD COLUMN b text;"}, headers=h())
    assert r.status_code == 200
    assert r.json()["classe"] == "auto"
    assert r.json()["pode_auto_aplicar"] is True


def test_cria_migracao_destrutiva_como_manual(cli):
    c, _ = cli
    r = c.post("/v1/releases", json={
        "tipo": "migracao", "alvo": "urban", "descricao": "drop",
        "sql": "DROP TABLE x;"}, headers=h())
    assert r.json()["classe"] == "manual"
    assert r.json()["pode_auto_aplicar"] is False
    assert any("DROP" in mo for mo in r.json()["motivos"])


def test_migracao_sem_sql_nega(cli):
    c, _ = cli
    r = c.post("/v1/releases", json={"tipo": "migracao", "alvo": "urban",
                                     "descricao": "x"}, headers=h())
    assert r.status_code == 400


def test_imagem_e_sempre_auto_com_janela_30min(cli):
    c, _ = cli
    r = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                     "descricao": "deploy sha-abc"}, headers=h())
    assert r.json()["classe"] == "auto"
    assert r.json()["janela_seg"] == 30 * 60


# --- fluxo apply -> confirm -----------------------------------------------

def test_apply_entra_em_provisoria_e_confirm_consolida(cli):
    c, mod = cli
    r = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                     "descricao": "deploy"}, headers=h())
    rid = r.json()["id"]
    fake = ExecutorFake()
    mod.REPO.set_exec(rid, fake.como_executor(mod))

    r2 = c.post(f"/v1/releases/{rid}/apply", headers=h())
    assert r2.status_code == 200
    assert r2.json()["estado"] == "provisoria"
    assert r2.json()["segundos_restantes"] > 0

    r3 = c.post(f"/v1/releases/{rid}/confirm", headers=h())
    assert r3.json()["estado"] == "consolidada"
    assert r3.json()["confirmada_por"] == OPERADOR
    assert not any("reverter" in x for x in fake.chamadas)


def test_apply_health_falho_reverte(cli):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                       "descricao": "deploy"}, headers=h()).json()["id"]
    fake = ExecutorFake(health=False)
    mod.REPO.set_exec(rid, fake.como_executor(mod))
    r = c.post(f"/v1/releases/{rid}/apply", headers=h())
    assert r.json()["estado"] == "revertida"
    assert r.json()["reverter_motivo"] == "health"


def test_apply_manual_e_recusado(cli):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "migracao", "alvo": "urban",
                                       "descricao": "drop", "sql": "DROP TABLE x;"},
                 headers=h()).json()["id"]
    mod.REPO.set_exec(rid, ExecutorFake().como_executor(mod))
    r = c.post(f"/v1/releases/{rid}/apply", headers=h())
    assert r.status_code == 409
    assert "expand/contract" in r.json()["detail"]


def test_revert_humano(cli):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                       "descricao": "d"}, headers=h()).json()["id"]
    fake = ExecutorFake()
    mod.REPO.set_exec(rid, fake.como_executor(mod))
    c.post(f"/v1/releases/{rid}/apply", headers=h())
    r = c.post(f"/v1/releases/{rid}/revert", headers=h())
    assert r.json()["estado"] == "revertida"
    assert r.json()["reverter_motivo"] == "humano"
    assert "reverter(bk-1)" in fake.chamadas


# --- reconciliador (relogio server-side) ----------------------------------

@pytest.mark.asyncio
async def test_reconciliador_reverte_release_expirada(cli, monkeypatch):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                       "descricao": "d"}, headers=h()).json()["id"]
    fake = ExecutorFake()
    mod.REPO.set_exec(rid, fake.como_executor(mod))
    c.post(f"/v1/releases/{rid}/apply", headers=h())

    rel = mod.REPO.get(rid)
    assert rel.estado == "provisoria"
    # força o deadline para o passado (relogio do servidor)
    rel.deadline = rel.deadline - timedelta(hours=1)

    avisos = []
    async def fake_notif(t): avisos.append(t)
    monkeypatch.setattr(mod, "notificar_telegram", fake_notif)

    await mod._tick_reconciliador()
    assert rel.estado == "revertida"
    assert rel.reverter_motivo == "timeout"
    assert "reverter(bk-1)" in fake.chamadas
    assert avisos and "revertida" in avisos[0].lower()


@pytest.mark.asyncio
async def test_reconciliador_ignora_release_confirmada(cli):
    c, mod = cli
    rid = c.post("/v1/releases", json={"tipo": "imagem", "alvo": "hermes-urban",
                                       "descricao": "d"}, headers=h()).json()["id"]
    fake = ExecutorFake()
    mod.REPO.set_exec(rid, fake.como_executor(mod))
    c.post(f"/v1/releases/{rid}/apply", headers=h())
    c.post(f"/v1/releases/{rid}/confirm", headers=h())
    await mod._tick_reconciliador()   # nao deve reverter
    assert mod.REPO.get(rid).estado == "consolidada"
