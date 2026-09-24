"""
Testes dos executores. O deployer (opcao A) tem invariantes de seguranca que
dao para provar sem EasyPanel real: allowlist de servicos e de procedures.
O executor de banco e' testado na parte que nao exige Postgres (montagem do
envelope, geracao de ref); o caminho psql real fica para o PR de apply-real.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import executores as ex  # noqa: E402


# --- deployer: allowlist de servicos --------------------------------------

def test_deployer_recusa_servico_fora_da_allowlist(monkeypatch):
    monkeypatch.setattr(ex, "SERVICOS_CONHECIDOS", {"hermes-platform/hermes-urban"})
    with pytest.raises(RuntimeError, match="fora da allowlist"):
        ex.ExecutorImagem("hermes-platform", "outro-servico",
                          "img:nova", "img:velha", "https://x/health")


def test_deployer_aceita_servico_conhecido(monkeypatch):
    monkeypatch.setattr(ex, "SERVICOS_CONHECIDOS", {"hermes-platform/hermes-urban"})
    d = ex.ExecutorImagem("hermes-platform", "hermes-urban",
                          "img:nova", "img:velha", "https://x/health")
    assert d.tag_nova == "img:nova"
    # a tag atual e' o backup
    assert d.fazer_backup() == "img:velha"


# --- deployer: allowlist de procedures ------------------------------------

def test_deployer_so_conhece_tres_procedures_de_escrita():
    assert ex.PROCEDURES_DEPLOY == frozenset(
        {"updateAppSourceImage", "updateAppDeploy", "deployAppService"})
    # nenhuma procedure de leitura-que-vaza nem destrutiva generica
    for proibida in ("inspectAppService", "getUser", "destroyAppService",
                     "listProjectsAndServices"):
        assert proibida not in ex.PROCEDURES_DEPLOY


def test_deployer_chamar_recusa_procedure_fora_da_lista(monkeypatch):
    monkeypatch.setattr(ex, "SERVICOS_CONHECIDOS", {"p/s"})
    monkeypatch.setenv("EASYPANEL_URL", "https://ep")
    monkeypatch.setenv("EASYPANEL_DEPLOY_KEY", "k")
    d = ex.ExecutorImagem("p", "s", "img:nova", "img:velha", "https://x/health")
    with pytest.raises(RuntimeError, match="nao permitida"):
        d._chamar("destroyAppService", {"projectName": "p", "serviceName": "s"})


def test_deployer_sem_credencial_recusa(monkeypatch):
    monkeypatch.setattr(ex, "SERVICOS_CONHECIDOS", {"p/s"})
    monkeypatch.setattr(ex, "SERVICOS_CONHECIDOS", {"p/s"})
    monkeypatch.delenv("EASYPANEL_URL", raising=False)
    monkeypatch.delenv("EASYPANEL_DEPLOY_KEY", raising=False)
    d = ex.ExecutorImagem("p", "s", "img:nova", "img:velha", "https://x/health")
    with pytest.raises(RuntimeError, match="sem EASYPANEL"):
        d._chamar("deployAppService", {"projectName": "p", "serviceName": "s"})


# --- deployer: revert repointa para a tag anterior ------------------------

def test_deployer_backup_e_tag_atual_revert_volta_para_ela(monkeypatch):
    monkeypatch.setattr(ex, "SERVICOS_CONHECIDOS", {"p/s"})
    d = ex.ExecutorImagem("p", "s", "img:nova", "img:velha", "https://x/health")
    chamadas = []
    monkeypatch.setattr(d, "_aplicar_tag", lambda tag: chamadas.append(tag))
    d.aplicar()
    d.reverter(d.fazer_backup())
    assert chamadas == ["img:nova", "img:velha"]   # aplica nova, reverte p/ velha


# --- executor de banco: montagem do envelope (sem psql real) --------------

def test_banco_gera_ref_de_backup_no_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(ex, "BACKUP_DIR", tmp_path / "bk")
    called = {}

    def fake_run(cmd, **kw):
        called["cmd"] = cmd
        class R: returncode = 0; stderr = ""
        return R()
    monkeypatch.setattr(ex.subprocess, "run", fake_run)
    b = ex.ExecutorBanco("postgresql://super@h/db", "urban", tmp_path / "m.sql")
    ref = b.fazer_backup()
    assert "urban-" in ref and ref.endswith(".dump")
    assert "pg_dump" in called["cmd"][0]
    assert "--schema" in called["cmd"] and "urban" in called["cmd"]


def test_banco_aplicar_envelopa_em_transacao_com_search_path(monkeypatch, tmp_path):
    sqlf = tmp_path / "m.sql"
    sqlf.write_text("CREATE TABLE x(a int);", encoding="utf-8")
    capturado = {}

    def fake_psql(self, *args, dsn=None, input_=None):
        capturado["input"] = input_
        class R: returncode = 0; stderr = ""
        return R()
    monkeypatch.setattr(ex.ExecutorBanco, "_psql", fake_psql)
    b = ex.ExecutorBanco("dsn", "urban", sqlf)
    b.aplicar()
    assert "BEGIN;" in capturado["input"]
    assert "SET LOCAL search_path = urban;" in capturado["input"]
    assert "CREATE TABLE x(a int);" in capturado["input"]
    assert "COMMIT;" in capturado["input"]
