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

    # catalogo aninhado por ciclo de vida (universal/ e clientes/<slug>/)
    (catalogo / "universal" / "urban-metas").mkdir(parents=True)
    (catalogo / "universal" / "urban-metas" / "SKILL.md").write_text(
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


def test_instala_skill_especifica_de_cliente(cli):
    """Skill sob medida vive em clientes/<slug>/especificas/ e resolve por nome."""
    c, data, catalogo, _ = cli
    esp = catalogo / "clientes" / "urban" / "especificas" / "urban-corridas"
    esp.mkdir(parents=True)
    (esp / "SKILL.md").write_text(
        "---\nname: urban-corridas\nversion: 0.1.0\n---\ncorpo\n", encoding="utf-8")
    r = c.post("/v1/skills/install", json={"skill": "urban-corridas"}, headers=h())
    assert r.status_code == 200
    assert r.json()["versao"] == "0.1.0"
    assert (data / "skills" / "urban-corridas" / "SKILL.md").is_file()


def test_overlay_nao_e_instalavel_inteiro(cli):
    """overlays/ guardam so DELTA — nao sao skill instalavel por nome."""
    c, _, catalogo, _ = cli
    ov = catalogo / "clientes" / "urban" / "overlays" / "so-delta"
    ov.mkdir(parents=True)
    (ov / "SKILL.md").write_text(
        "---\nname: so-delta\nversion: 0.1.0\n---\ndelta\n", encoding="utf-8")
    r = c.post("/v1/skills/install", json={"skill": "so-delta"}, headers=h())
    assert r.status_code == 404


def test_skill_ambigua_no_catalogo_da_409(cli):
    """Mesmo nome em universal/ e especificas/ e' erro explicito, nao palpite."""
    c, _, catalogo, _ = cli
    dup = catalogo / "clientes" / "urban" / "especificas" / "urban-metas"
    dup.mkdir(parents=True)
    (dup / "SKILL.md").write_text(
        "---\nname: urban-metas\nversion: 9.9.9\n---\noutra\n", encoding="utf-8")
    r = c.post("/v1/skills/install", json={"skill": "urban-metas"}, headers=h())
    assert r.status_code == 409


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


# --- plugins ---------------------------------------------------------------

@pytest.fixture()
def cli_plugins(cli, tmp_path: Path, monkeypatch):
    c, data, catalogo, mod = cli
    pcat = tmp_path / "catalogo-plugins"
    (pcat / "marketing" / "motor" / "node_modules" / "pg").mkdir(parents=True)
    (pcat / "marketing" / "motor" / "node_modules" / "pg" / "index.js").write_text("// 50MB", encoding="utf-8")
    (pcat / "marketing" / "plugin.yaml").write_text(
        "name: marketing\nversion: 1.0.0\nprovides_tools:\n  - marketing_config\n", encoding="utf-8")
    (pcat / "marketing" / "__init__.py").write_text("def register(ctx): pass\n", encoding="utf-8")
    monkeypatch.setattr(mod, "PLUGIN_CATALOG_DIR", pcat)
    return c, data, pcat, mod


def test_lista_plugins_e_catalogo(cli_plugins):
    c, data, pcat, mod = cli_plugins
    r = c.get("/v1/plugins", headers=h())
    assert r.status_code == 200
    assert r.json() == {"instalados": [], "habilitados": [], "catalogo_disponivel": ["marketing"]}


def test_instala_plugin_sem_motor_e_habilita_no_config(cli_plugins):
    c, data, pcat, mod = cli_plugins
    (data / "config.yaml").write_text("model: x\nplugins:\n  enabled:\n    - outro\n", encoding="utf-8")
    r = c.post("/v1/plugins/install", json={"plugin": "marketing"}, headers=h())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["acao"] == "instalado"
    assert body["ferramentas"] == ["marketing_config"]
    assert body["habilitado_no_config"] is True
    assert (data / "plugins" / "marketing" / "__init__.py").is_file()
    assert not (data / "plugins" / "marketing" / "motor").exists(), "motor fica na imagem, nao no volume"
    import yaml
    cfg = yaml.safe_load((data / "config.yaml").read_text(encoding="utf-8"))
    assert cfg["plugins"]["enabled"] == ["outro", "marketing"]
    assert cfg["model"] == "x", "resto do config preservado"
    # idempotente
    r2 = c.post("/v1/plugins/install", json={"plugin": "marketing"}, headers=h())
    assert r2.json()["acao"] == "atualizado"
    assert yaml.safe_load((data / "config.yaml").read_text(encoding="utf-8"))["plugins"]["enabled"] == ["outro", "marketing"]
    assert c.get("/v1/plugins", headers=h()).json()["instalados"][0]["nome"] == "marketing"


def test_instala_plugin_cria_config_se_nao_existe(cli_plugins):
    c, data, pcat, mod = cli_plugins
    assert not (data / "config.yaml").exists()
    r = c.post("/v1/plugins/install", json={"plugin": "marketing"}, headers=h())
    assert r.status_code == 200
    import yaml
    assert yaml.safe_load((data / "config.yaml").read_text(encoding="utf-8")) == {"plugins": {"enabled": ["marketing"]}}


@pytest.mark.parametrize("ruim", ["../etc", "marketing/../x", "MARKETING!"])
def test_plugin_fora_do_catalogo_nega(cli_plugins, ruim):
    c, *_ = cli_plugins
    r = c.post("/v1/plugins/install", json={"plugin": ruim}, headers=h())
    assert r.status_code in (400, 404, 422)
    r = c.post("/v1/plugins/install", json={"plugin": "inexistente"}, headers=h())
    assert r.status_code == 404


# --- verbo: prepare (skill em profile isolado, sem ativar) ----------------

def test_prepara_skill_em_profile_isolado(cli):
    """Constroi profiles/<skill>/ com a skill; nao toca o profile default."""
    c, data, _, _ = cli
    r = c.post("/v1/skills/prepare", json={"skill": "urban-metas"}, headers=h())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estado"] == "preparada"
    assert body["profile"] == "urban-metas"          # default = nome da skill
    assert body["versao"] == "1.2.0"
    # skill no PROFILE, nao no default
    assert (data / "profiles" / "urban-metas" / "skills" / "urban-metas" / "SKILL.md").is_file()
    assert not (data / "skills" / "urban-metas").exists(), "prepare nao instala no default"


def test_prepare_nao_ativa_nao_reinicia(cli):
    """prepare para ANTES de ativar: nao mexe no config.yaml do default nem sinaliza restart."""
    c, data, _, _ = cli
    (data / "config.yaml").write_text("model: x\n", encoding="utf-8")
    r = c.post("/v1/skills/prepare", json={"skill": "urban-metas"}, headers=h())
    assert r.status_code == 200
    # o config do DEFAULT continua intocado (ativar e' passo humano)
    assert (data / "config.yaml").read_text(encoding="utf-8") == "model: x\n"
    assert "human" in r.json()["observacao"].lower() or "humana" in r.json()["observacao"].lower()


def test_prepare_semeia_env_proprio_com_api_server_key(cli):
    """.env do profile: chaves seed copiadas do default + API_SERVER_KEY gerada."""
    c, data, _, _ = cli
    # o .env default do fixture tem OPENROUTER_API_KEY=chave-antiga
    (data / ".env").write_text(
        "OPENROUTER_API_KEY=chave-antiga\nGEMINI_API_KEY=g-123\n", encoding="utf-8")
    r = c.post("/v1/skills/prepare", json={"skill": "urban-metas"}, headers=h())
    assert r.status_code == 200
    body = r.json()
    prof_env = (data / "profiles" / "urban-metas" / ".env").read_text(encoding="utf-8")
    # semeou as duas que existiam no default + gerou a propria
    assert "OPENROUTER_API_KEY=chave-antiga" in prof_env
    assert "GEMINI_API_KEY=g-123" in prof_env
    assert "API_SERVER_KEY=" in prof_env
    assert "API_SERVER_KEY" in body["credenciais_semeadas"]
    # resposta nunca vaza valor
    assert "chave-antiga" not in r.text and "g-123" not in r.text


def test_prepare_reporta_credencial_ausente_para_checklist(cli):
    """As chaves seed que faltam no default viram checklist (credenciais_ausentes)."""
    c, data, _, _ = cli
    (data / ".env").write_text("ANTHROPIC_API_KEY=sk-x\n", encoding="utf-8")
    r = c.post("/v1/skills/prepare", json={"skill": "urban-metas"}, headers=h())
    ausentes = r.json()["credenciais_ausentes"]
    assert "NANO_BANANA_API_KEY" in ausentes
    assert "GEMINI_API_KEY" in ausentes
    assert "ANTHROPIC_API_KEY" not in ausentes  # essa existia


def test_prepare_com_plugin_dep_copia_sem_motor_e_habilita_no_profile(cli, tmp_path, monkeypatch):
    """plugin-dep entra no profile sem motor/ e vira plugins.enabled no config DO PROFILE."""
    c, data, catalogo, mod = cli
    pcat = tmp_path / "pcat"
    (pcat / "marketing" / "motor" / "node_modules").mkdir(parents=True)
    (pcat / "marketing" / "motor" / "big.js").write_text("//", encoding="utf-8")
    (pcat / "marketing" / "plugin.yaml").write_text(
        "name: marketing\nversion: 1.0.0\nprovides_tools:\n  - marketing_config\n", encoding="utf-8")
    (pcat / "marketing" / "__init__.py").write_text("def register(ctx): pass\n", encoding="utf-8")
    monkeypatch.setattr(mod, "PLUGIN_CATALOG_DIR", pcat)

    r = c.post("/v1/skills/prepare",
               json={"skill": "urban-metas", "plugin_dep": "marketing"}, headers=h())
    assert r.status_code == 200, r.text
    prof = data / "profiles" / "urban-metas"
    assert (prof / "plugins" / "marketing" / "__init__.py").is_file()
    assert not (prof / "plugins" / "marketing" / "motor").exists(), "motor fica na imagem"
    import yaml
    cfg = yaml.safe_load((prof / "config.yaml").read_text(encoding="utf-8"))
    assert cfg["plugins"]["enabled"] == ["marketing"]
    assert r.json()["plugin"]["ferramentas"] == ["marketing_config"]


def test_prepare_plugin_dep_inexistente_nega(cli):
    c, *_ = cli
    r = c.post("/v1/skills/prepare",
               json={"skill": "urban-metas", "plugin_dep": "nao-existe"}, headers=h())
    assert r.status_code == 404


def test_prepare_skill_fora_do_catalogo_nega(cli):
    c, *_ = cli
    assert c.post("/v1/skills/prepare", json={"skill": "fantasma"}, headers=h()).status_code == 404


@pytest.mark.parametrize("malicioso", ["../../etc", "a/b", "COM1", ".oculta"])
def test_prepare_profile_malicioso_nega(cli, malicioso):
    c, *_ = cli
    r = c.post("/v1/skills/prepare",
               json={"skill": "urban-metas", "profile": malicioso}, headers=h())
    assert r.status_code in (400, 404, 422), malicioso


def test_prepare_re_preparo_faz_backup(cli):
    """Re-preparar guarda a versao anterior como backup (mesma regra do install)."""
    c, data, _, _ = cli
    c.post("/v1/skills/prepare", json={"skill": "urban-metas"}, headers=h())
    r = c.post("/v1/skills/prepare", json={"skill": "urban-metas"}, headers=h())
    assert r.status_code == 200
    backups = list((data / "profiles" / "urban-metas" / "skills").glob(".backup-urban-metas-*"))
    assert backups


def test_prepare_sem_auditoria_e_recusado(cli):
    """Preparar sem trilha e' pior que preparar que nao aconteceu."""
    c, data, _, mod = cli
    original = mod.auditar
    try:
        def fake(operador, acao, detalhe, resultado, erro=None, *, obrigatorio):
            if obrigatorio:
                from fastapi import HTTPException
                raise HTTPException(503, "auditoria indisponivel; acao recusada")
        mod.auditar = fake
        r = c.post("/v1/skills/prepare", json={"skill": "urban-metas"}, headers=h())
        assert r.status_code == 503
        assert not (data / "profiles" / "urban-metas").exists()  # nada escrito
    finally:
        mod.auditar = original
