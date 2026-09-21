"""
Testes da Admin API. Rodam sem Docker e sem Postgres.

O foco nao e' cobertura: e' provar as promessas de seguranca do plano B.
Cada teste corresponde a uma frase do docs/onboarding-e-acessos.md.
"""
from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TOKEN = "token-de-teste-1234567890"
OPERADOR = "herbert@assessoria"


@pytest.fixture()
def cli(tmp_path: Path, monkeypatch):
    data = tmp_path / "data"
    catalogo = tmp_path / "catalogo"
    (data / "logs").mkdir(parents=True)
    (data / "skills").mkdir(parents=True)
    (data / "sessions").mkdir(parents=True)
    (data / "memories").mkdir(parents=True)

    (data / "logs" / "gateway.log").write_text(
        "\n".join(f"linha {i}" for i in range(500)), encoding="utf-8")
    (data / "sessions" / "segredo.jsonl").write_text("conversa privada", encoding="utf-8")
    (data / ".env").write_text("OPENROUTER_API_KEY=chave-antiga\n", encoding="utf-8")

    (catalogo / "urban-metas").mkdir(parents=True)
    (catalogo / "urban-metas" / "SKILL.md").write_text(
        "---\nname: urban-metas\nversion: 1.2.0\n---\ncorpo\n", encoding="utf-8")

    monkeypatch.setenv("HERMES_DATA_DIR", str(data))
    monkeypatch.setenv("PRODUCT_CATALOG_DIR", str(catalogo))
    monkeypatch.setenv("TENANT_SLUG", "urban")
    monkeypatch.setenv("ADMIN_API_TOKEN_SHA256", hashlib.sha256(TOKEN.encode()).hexdigest())
    monkeypatch.setenv("ADMIN_AUDIT_DSN", "")
    monkeypatch.setenv("ADMIN_AUDIT_MODE", "file")
    monkeypatch.setenv("ADMIN_API_IP_ALLOWLIST", "")

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    for mod in [m for m in sys.modules if m == "app"]:
        del sys.modules[mod]
    import app as mod  # noqa: PLC0415

    yield TestClient(mod.app), data, catalogo, mod


def h(extra: dict | None = None) -> dict:
    base = {"Authorization": f"Bearer {TOKEN}", "X-Operador": OPERADOR}
    base.update(extra or {})
    return base


# --- autenticacao ---------------------------------------------------------

def test_sem_token_nega(cli):
    c, *_ = cli
    assert c.get("/v1/status").status_code == 401


def test_token_errado_nega(cli):
    c, *_ = cli
    r = c.get("/v1/status", headers={"Authorization": "Bearer errado", "X-Operador": OPERADOR})
    assert r.status_code == 401


def test_sem_operador_nega(cli):
    """Auditoria sem nome e' log, nao auditoria."""
    c, *_ = cli
    r = c.get("/v1/status", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 400
    assert "X-Operador" in r.json()["detail"]


def test_health_e_publico(cli):
    c, *_ = cli
    assert c.get("/health").status_code == 200


def test_sem_swagger_publico(cli):
    c, *_ = cli
    assert c.get("/docs").status_code == 404
    assert c.get("/openapi.json").status_code == 404


# --- o que a API NAO pode fazer (o coracao do plano B) --------------------

def test_nao_le_sessions(cli):
    """A conversa do cliente e' inalcancavel: nao ha rota, e o path esta preso."""
    c, *_ = cli
    for tentativa in ["../sessions/segredo.jsonl",
                      "..\\sessions\\segredo.jsonl",
                      "/opt/data/sessions/segredo.jsonl"]:
        r = c.get("/v1/logs", params={"arquivo": tentativa}, headers=h())
        assert r.status_code == 400, tentativa


def test_nao_le_env_por_traversal(cli):
    c, *_ = cli
    r = c.get("/v1/logs", params={"arquivo": "../.env"}, headers=h())
    assert r.status_code == 400


def test_status_nao_vaza_valor_de_credencial(cli):
    c, *_ = cli
    corpo = c.get("/v1/status", headers=h()).text
    assert "chave-antiga" not in corpo
    assert c.get("/v1/status", headers=h()).json()["credenciais_configuradas"]["OPENROUTER_API_KEY"] is True


def test_credenciais_nao_sao_lidas_de_volta(cli):
    """Comprometer o token permite SOBRESCREVER, nunca exfiltrar."""
    c, *_ = cli
    r = c.post("/v1/credentials", json={"credenciais": {"OPENAI_API_KEY": "nova-chave"}}, headers=h())
    assert r.status_code == 200
    assert "nova-chave" not in r.text
    assert "chave-antiga" not in r.text


# --- verbo: skills --------------------------------------------------------

def test_lista_skills_e_catalogo(cli):
    c, *_ = cli
    r = c.get("/v1/skills", headers=h())
    assert r.status_code == 200
    assert r.json()["catalogo_disponivel"] == ["urban-metas"]
    assert r.json()["instaladas"] == []


def test_instala_do_catalogo(cli):
    c, data, _, _ = cli
    r = c.post("/v1/skills/install", json={"skill": "urban-metas"}, headers=h())
    assert r.status_code == 200
    assert r.json()["acao"] == "instalada"
    assert r.json()["versao"] == "1.2.0"
    assert (data / "skills" / "urban-metas" / "SKILL.md").is_file()


def test_reinstalar_faz_backup(cli):
    c, data, _, _ = cli
    c.post("/v1/skills/install", json={"skill": "urban-metas"}, headers=h())
    r = c.post("/v1/skills/install", json={"skill": "urban-metas"}, headers=h())
    assert r.json()["acao"] == "atualizada"
    assert list((data / "skills").glob(".backup-urban-metas-*"))


def test_skill_fora_do_catalogo_nega(cli):
    c, *_ = cli
    assert c.post("/v1/skills/install", json={"skill": "nao-existe"}, headers=h()).status_code == 404


@pytest.mark.parametrize("malicioso", ["../../etc", "..%2f..%2fetc", "a/b", "COM1", ".oculta"])
def test_nome_de_skill_malicioso_nega(cli, malicioso):
    c, *_ = cli
    r = c.post("/v1/skills/install", json={"skill": malicioso}, headers=h())
    assert r.status_code in (400, 404, 422), malicioso


def test_nao_existe_upload_de_skill(cli):
    """Skill por HTTP seria execucao de codigo arbitrario com outro nome."""
    c, *_ = cli
    r = c.post("/v1/skills/install",
               json={"skill": "urban-metas", "conteudo": "---\nname: x\n---\nrm -rf /"},
               headers=h())
    # o campo extra e' ignorado; a origem continua sendo o catalogo da imagem
    assert r.status_code == 200
    assert r.json()["versao"] == "1.2.0"


# --- verbo: logs ----------------------------------------------------------

def test_le_logs_com_limite(cli):
    c, *_ = cli
    r = c.get("/v1/logs", params={"linhas": 10}, headers=h())
    assert r.status_code == 200
    assert r.json()["linhas"] == 10


def test_limite_de_linhas_e_teto(cli):
    c, *_ = cli
    assert c.get("/v1/logs", params={"linhas": 99999}, headers=h()).json()["linhas"] <= 2000


def test_log_inexistente_lista_disponiveis(cli):
    c, *_ = cli
    r = c.get("/v1/logs", params={"arquivo": "fantasma.log"}, headers=h())
    assert r.status_code == 404
    assert "gateway.log" in r.json()["detail"]


# --- verbo: credenciais ---------------------------------------------------

def test_grava_credencial_permitida(cli):
    c, data, _, _ = cli
    r = c.post("/v1/credentials",
               json={"credenciais": {"ANTHROPIC_API_KEY": "sk-ant-x", "TELEGRAM_BOT_TOKEN": "123:abc"}},
               headers=h())
    assert r.status_code == 200
    assert r.json()["novas"] == ["ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN"]
    texto = (data / ".env").read_text(encoding="utf-8")
    assert "ANTHROPIC_API_KEY=sk-ant-x" in texto
    assert "OPENROUTER_API_KEY=chave-antiga" in texto  # preserva o que ja existia


def test_sobrescrita_e_reportada(cli):
    c, *_ = cli
    r = c.post("/v1/credentials", json={"credenciais": {"OPENROUTER_API_KEY": "nova"}}, headers=h())
    assert r.json()["sobrescritas"] == ["OPENROUTER_API_KEY"]
    assert r.json()["novas"] == []


def test_chave_fora_da_allowlist_nega(cli):
    """Allowlist, nao denylist: uma denylist erra por omissao."""
    c, *_ = cli
    for chave in ["PATH", "LD_PRELOAD", "DATABASE_URL", "ADMIN_API_TOKEN_SHA256"]:
        r = c.post("/v1/credentials", json={"credenciais": {chave: "x"}}, headers=h())
        assert r.status_code == 422, chave


def test_quebra_de_linha_no_valor_nega(cli):
    """Quebra de linha num .env injeta outra variavel."""
    c, *_ = cli
    r = c.post("/v1/credentials",
               json={"credenciais": {"OPENAI_API_KEY": "x\nDATABASE_URL=postgres://mau"}},
               headers=h())
    assert r.status_code == 422


def test_env_permanece_0600(cli):
    c, data, _, _ = cli
    c.post("/v1/credentials", json={"credenciais": {"OPENAI_API_KEY": "x"}}, headers=h())
    if os.name != "nt":
        assert oct((data / ".env").stat().st_mode)[-3:] == "600"


# --- auditoria ------------------------------------------------------------

def test_mutacao_sem_auditoria_e_recusada(cli):
    """Um install sem trilha e' pior que um install que nao aconteceu."""
    c, data, _, mod = cli
    mod.AUDIT_DSN = "postgresql://inalcancavel:5432/x"

    def audit_quebrado(*a, **kw):
        raise RuntimeError("banco fora")

    original = mod.auditar
    try:
        def fake(operador, acao, detalhe, resultado, erro=None, *, obrigatorio):
            if obrigatorio:
                from fastapi import HTTPException
                raise HTTPException(503, "auditoria indisponivel; acao recusada")
        mod.auditar = fake
        r = c.post("/v1/skills/install", json={"skill": "urban-metas"}, headers=h())
        assert r.status_code == 503
        assert not (data / "skills" / "urban-metas").exists()  # nada foi escrito

        r = c.post("/v1/credentials", json={"credenciais": {"OPENAI_API_KEY": "x"}}, headers=h())
        assert r.status_code == 503
        assert "OPENAI_API_KEY" not in (data / ".env").read_text(encoding="utf-8")
    finally:
        mod.auditar = original


def test_leitura_sem_auditoria_degrada_para_arquivo(cli):
    """Sem Postgres alcancavel, leitura segue e a trilha cai para arquivo."""
    c, data, _, mod = cli
    mod.AUDIT_MODE = "db"
    mod.AUDIT_DSN = ""
    try:
        assert c.get("/v1/status", headers=h()).status_code == 200
        assert (data / "logs" / "admin-audit-fallback.jsonl").is_file()
    finally:
        mod.AUDIT_MODE = "file"


def test_modo_db_sem_dsn_recusa_mutacao(cli):
    """O default de producao falha fechado."""
    c, data, _, mod = cli
    mod.AUDIT_MODE = "db"
    mod.AUDIT_DSN = ""
    try:
        r = c.post("/v1/skills/install", json={"skill": "urban-metas"}, headers=h())
        assert r.status_code == 503
        assert not (data / "skills" / "urban-metas").exists()
    finally:
        mod.AUDIT_MODE = "file"


def test_api_sem_token_configurado_nao_atende(cli, monkeypatch):
    c, _, _, mod = cli
    monkeypatch.setattr(mod, "ADMIN_TOKEN_HASH", "")
    assert c.get("/v1/status", headers=h()).status_code == 503
