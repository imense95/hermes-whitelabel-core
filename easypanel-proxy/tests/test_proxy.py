"""
Testes do EasyPanel Proxy.

Cada teste corresponde a uma promessa feita ao usuario. O foco esta nos
casos de RECUSA: o valor do proxy e' o que ele se nega a fazer.

O EasyPanel real nunca e' chamado — o transporte e' interceptado.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TOKEN = "token-proxy-de-teste"
OP = "herbert@assessoria"


@pytest.fixture()
def cli(tmp_path, monkeypatch):
    monkeypatch.setenv("EASYPANEL_URL", "http://painel-falso:3000")
    monkeypatch.setenv("EASYPANEL_API_KEY", "chave-admin-secreta-abc123")
    monkeypatch.setenv("PROXY_TOKEN_SHA256", hashlib.sha256(TOKEN.encode()).hexdigest())
    monkeypatch.setenv("PROXY_LOG_DIR", str(tmp_path / "logs"))

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    sys.modules.pop("app", None)
    import app as mod  # noqa: PLC0415

    chamadas: list[tuple[str, dict]] = []

    async def transporte_falso(procedure, input_, operador):
        """Substitui só a ida à rede; allowlist/denylist/scrub continuam reais."""
        real = mod.consultar
        # revalida pelas mesmas portas do codigo de producao
        if procedure in mod.DENYLIST:
            mod.trilha(operador, procedure, "NEGADO", "denylist")
            from fastapi import HTTPException
            raise HTTPException(403, f"'{procedure}' bloqueada: devolve credencial")
        if mod.PREFIXO_ESCRITA.match(procedure):
            from fastapi import HTTPException
            raise HTTPException(403, f"'{procedure}' parece escrita; o proxy so le")
        if procedure not in mod.ALLOWLIST:
            from fastapi import HTTPException
            raise HTTPException(403, f"'{procedure}' nao esta na allowlist")
        chamadas.append((procedure, input_ or {}))
        mod.trilha(operador, procedure, "OK")
        return mod.scrub(RESPOSTAS.get(procedure, {"ok": True}))

    monkeypatch.setattr(mod, "consultar", transporte_falso)
    yield TestClient(mod.app), mod, chamadas, tmp_path


RESPOSTAS = {
    "listProjects": [{"name": "chatwoot"}, {"name": "dashboard"}],
    "getUpdateStatus": {"version": "2.1.0", "updateAvailable": False},
    "listPorts": [{"published": 8080, "target": 80}],
    "listMounts": [{"type": "volume", "name": "dados"}],
    "queryServiceLogs": {"entries": [
        {"ts": "2026-09-21T10:00:00Z", "line": "servidor iniciado"},
        {"ts": "2026-09-21T10:00:01Z", "line": "DATABASE_URL=postgresql://u:s@h/db"},
    ]},
    "queryComposeServiceLogs": {"entries": []},
    "getAllServicesStats": [{"service": "api", "cpu": 3.2, "mem": 512}],
    "getMetricsSystemStats": {"cpu": 12.5, "mem": 62.0},
    "getMetricsServiceStats": {"cpu": [[0, 1.2]], "mem": [[0, 400]]},
    "getDockerContainers": [{"id": "abc123", "state": "running"}],
}


def h(extra=None):
    d = {"Authorization": f"Bearer {TOKEN}", "X-Operador": OP}
    d.update(extra or {})
    return d


# --- autenticacao ---------------------------------------------------------

def test_sem_token_nega(cli):
    c, *_ = cli
    assert c.get("/v1/projects").status_code == 401


def test_sem_operador_nega(cli):
    c, *_ = cli
    r = c.get("/v1/projects", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 400


def test_health_publico(cli):
    c, *_ = cli
    assert c.get("/health").status_code == 200


def test_sem_swagger(cli):
    c, *_ = cli
    assert c.get("/docs").status_code == 404
    assert c.get("/openapi.json").status_code == 404


# --- o que o proxy se NEGA a fazer ---------------------------------------

def test_nao_existe_funcao_de_escrita(cli):
    """A promessa central: escrita nao e' bloqueada, e' inexistente.

    Verifica o codigo real, ignorando comentarios e docstrings — eles falam
    de escrita justamente para explicar por que ela nao existe.
    """
    import ast
    _, mod, _, _ = cli
    arvore = ast.parse(Path(mod.__file__).read_text(encoding="utf-8"))

    # nenhuma chamada HTTP de escrita ao EasyPanel
    for no in ast.walk(arvore):
        if isinstance(no, ast.Attribute) and no.attr in {"post", "put", "patch", "delete"}:
            raise AssertionError(f"proxy nao pode chamar .{no.attr}() — e' so leitura")

    # nenhuma rota de escrita exposta ao agente
    for rota in mod.app.routes:
        for metodo in getattr(rota, "methods", set()) or set():
            assert metodo in {"GET", "HEAD", "OPTIONS"}, \
                f"rota {getattr(rota, 'path', '?')} expoe {metodo}"


def test_getuser_bloqueada(cli):
    """A procedure que vazou apiToken e twoFactorSecret."""
    c, mod, _, _ = cli
    assert "getUser" in mod.DENYLIST


def test_listprojectsandservices_bloqueada(cli):
    """A que devolve env e token de toda a producao."""
    c, mod, _, _ = cli
    assert "listProjectsAndServices" in mod.DENYLIST


@pytest.mark.parametrize("proc", [
    "getUser", "getSession", "listProjectsAndServices",
    "getWordPressUsers", "listAccounts", "listTunnels",
])
def test_denylist_recusa(cli, proc):
    import asyncio
    _, mod, _, _ = cli
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        asyncio.run(mod.consultar(proc, {}, OP))
    assert e.value.status_code == 403


@pytest.mark.parametrize("proc", [
    "createService", "deleteProject", "restartService", "deployService",
    "updateUser", "resetPassword", "revokeToken", "destroyVolume",
    "execCommand", "setEnv",
])
def test_prefixo_de_escrita_recusa(cli, proc):
    import asyncio
    _, mod, _, _ = cli
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        asyncio.run(mod.consultar(proc, {}, OP))
    assert e.value.status_code == 403


def test_procedure_desconhecida_recusa(cli):
    """Allowlist: o que nao esta na lista nao passa, mesmo sendo leitura."""
    import asyncio
    _, mod, _, _ = cli
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        asyncio.run(mod.consultar("getMetricsHistory", {}, OP))
    assert e.value.status_code == 403


# --- scrub ----------------------------------------------------------------

def test_scrub_redige_chave_suspeita(cli):
    _, mod, _, _ = cli
    entrada = {
        "name": "servico",
        "apiToken": "f" * 64,              # sintetico, formato do real
        "twoFactorSecret": "AAAABBBBCCCCDDDD",
        "env": "OPERATOR_TOKEN=abc\nFM_TOKEN=def",
        "password": "senha123",
    }
    saida = mod.scrub(entrada)
    assert saida["name"] == "servico"
    for k in ("apiToken", "twoFactorSecret", "env", "password"):
        assert saida[k] == mod.REDIGIDO


def test_scrub_pega_valor_secreto_sob_chave_inocente(cli):
    """Defesa contra o caso nao previsto: o valor denuncia."""
    _, mod, _, _ = cli
    saida = mod.scrub({
        "descricao": "use ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345 para clonar",
        "conn": "postgresql://user:senha@host:5432/db",
        "hex": "a" * 64,
    })
    assert mod.REDIGIDO in saida["descricao"]
    assert mod.REDIGIDO in saida["conn"]
    assert mod.REDIGIDO in saida["hex"]


def test_scrub_e_recursivo(cli):
    _, mod, _, _ = cli
    saida = mod.scrub({"a": [{"b": {"token": "x"}}, {"c": "ok"}]})
    assert saida["a"][0]["b"]["token"] == mod.REDIGIDO
    assert saida["a"][1]["c"] == "ok"


def test_scrub_nao_estoura_em_estrutura_profunda(cli):
    _, mod, _, _ = cli
    d = {}
    cur = d
    for _ in range(80):
        cur["n"] = {}
        cur = cur["n"]
    assert mod.scrub(d)  # nao levanta


# --- a chave admin nunca sai ----------------------------------------------

def test_chave_admin_nunca_aparece_na_resposta(cli):
    c, mod, _, _ = cli
    for rota in ["/v1/projects", "/v1/panel/status", "/v1/allowlist"]:
        corpo = c.get(rota, headers=h()).text
        assert "chave-admin-secreta-abc123" not in corpo


def test_erro_do_painel_nao_ecoa_corpo(cli):
    """Corpo de erro do EasyPanel pode conter eco da chave."""
    _, mod, _, _ = cli
    fonte = Path(mod.__file__).read_text(encoding="utf-8")
    assert "nunca devolve o corpo do erro" in fonte


# --- verbos permitidos ----------------------------------------------------

def test_lista_projetos(cli):
    c, _, chamadas, _ = cli
    r = c.get("/v1/projects", headers=h())
    assert r.status_code == 200
    assert r.json()["projetos"][0]["name"] == "chatwoot"
    assert chamadas[0][0] == "listProjects"


def test_status_do_painel(cli):
    c, *_ = cli
    r = c.get("/v1/panel/status", headers=h())
    assert r.status_code == 200
    assert r.json()["atualizacao"]["version"] == "2.1.0"


def test_portas_exigem_alvo_valido(cli):
    c, *_ = cli
    assert c.get("/v1/service/ports",
                 params={"projectName": "dashboard", "serviceName": "api"},
                 headers=h()).status_code == 200
    # injecao no nome do projeto
    r = c.get("/v1/service/ports",
              params={"projectName": "../../etc", "serviceName": "api"},
              headers=h())
    assert r.status_code == 422


# --- endpoints de log e metrica (confirmados na doc da API) --------------

def test_le_logs_de_servico(cli):
    c, _, chamadas, _ = cli
    r = c.get("/v1/service/logs",
              params={"projectName": "dashboard", "serviceName": "api", "limit": 50},
              headers=h())
    assert r.status_code == 200
    proc, entrada = chamadas[-1]
    assert proc == "queryServiceLogs"
    assert entrada["limit"] == 50


def test_log_com_segredo_na_linha_e_redigido(cli):
    """Log e' texto livre: um DSN pode aparecer no meio de uma linha."""
    c, mod, _, _ = cli
    corpo = c.get("/v1/service/logs",
                  params={"projectName": "dashboard", "serviceName": "api"},
                  headers=h()).text
    assert "postgresql://u:s@h/db" not in corpo
    assert mod.REDIGIDO in corpo


def test_limite_de_logs_respeita_teto_do_easypanel(cli):
    c, *_ = cli
    assert c.get("/v1/service/logs",
                 params={"projectName": "d", "serviceName": "a", "limit": 5000},
                 headers=h()).status_code == 422


def test_stream_invalido_recusado(cli):
    c, *_ = cli
    assert c.get("/v1/service/logs",
                 params={"projectName": "d", "serviceName": "a", "stream": "syslog"},
                 headers=h()).status_code == 422


def test_metricas_de_servico(cli):
    c, _, chamadas, _ = cli
    r = c.get("/v1/service/stats",
              params={"projectName": "dashboard", "serviceName": "api"}, headers=h())
    assert r.status_code == 200
    assert chamadas[-1][0] == "getMetricsServiceStats"


def test_metricas_gerais_juntam_servicos_e_sistema(cli):
    c, *_ = cli
    r = c.get("/v1/stats", headers=h()).json()
    assert r["servicos"][0]["service"] == "api"
    assert r["sistema"]["cpu"] == 12.5


def test_containers_de_servico(cli):
    c, _, chamadas, _ = cli
    r = c.get("/v1/service/containers", params={"service": "dashboard_api"}, headers=h())
    assert r.status_code == 200
    assert chamadas[-1][0] == "getDockerContainers"


@pytest.mark.parametrize("proc", [
    "inspectProject", "inspectAppService", "inspectPostgresService",
])
def test_inspect_fica_fora_da_allowlist(cli, proc):
    """Uteis para diagnostico e justamente por isso vazam: devolvem env."""
    import asyncio
    _, mod, _, _ = cli
    assert proc not in mod.ALLOWLIST
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        asyncio.run(mod.consultar(proc, {}, OP))
    assert e.value.status_code == 403


def test_params_viram_query_plana(cli):
    """A API do EasyPanel e' GET /api/<proc>?a=1&b=2 — nao /api/trpc/?input=."""
    _, mod, _, _ = cli
    assert mod._params_planos({"a": 1, "b": None, "c": ["x", "y"], "d": True}) == [
        ("a", "1"), ("c", "x"), ("c", "y"), ("d", "true"),
    ]


def test_url_montada_e_plana(monkeypatch, tmp_path):
    """Regressao: o script inicial usava /api/trpc/<proc>?input=<json> e
    levou 404 em tudo. A URL correta e' /api/<proc>?param=valor."""
    import asyncio
    import httpx

    monkeypatch.setenv("EASYPANEL_URL", "http://painel:3000")
    monkeypatch.setenv("EASYPANEL_API_KEY", "k")
    monkeypatch.setenv("PROXY_TOKEN_SHA256", "x" * 64)
    monkeypatch.setenv("PROXY_LOG_DIR", str(tmp_path))
    sys.modules.pop("app", None)
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    import app as mod

    visto = {}

    class RespFalsa:
        status_code = 200
        def json(self): return {"ok": True}

    class ClienteFalso:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params=None, headers=None):
            visto["url"] = url
            visto["params"] = params
            return RespFalsa()

    monkeypatch.setattr(httpx, "AsyncClient", ClienteFalso)
    asyncio.run(mod.consultar(
        "queryServiceLogs",
        {"projectName": "dashboard", "serviceName": "api", "limit": 50},
        "op",
    ))

    assert visto["url"] == "http://painel:3000/api/queryServiceLogs"
    assert "/trpc/" not in visto["url"]
    assert ("projectName", "dashboard") in visto["params"]
    assert ("limit", "50") in visto["params"]


def test_allowlist_e_autodescritiva(cli):
    c, *_ = cli
    r = c.get("/v1/allowlist", headers=h()).json()
    assert "listProjects" in r["permitidas"]
    assert "getUser" in r["bloqueadas"]
    assert "impossivel" in r["escrita"]


# --- trilha ---------------------------------------------------------------

def test_trilha_registra_chamada_e_recusa(cli):
    c, mod, _, tmp = cli
    c.get("/v1/projects", headers=h())
    import asyncio
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        asyncio.run(mod.consultar("getUser", {}, OP))

    texto = (tmp / "logs" / "easypanel-proxy.log").read_text(encoding="utf-8")
    assert "listProjects\tOK" in texto
    assert "getUser\tNEGADO" in texto
    assert OP in texto


def test_proxy_sem_token_configurado_nao_atende(cli, monkeypatch):
    c, mod, _, _ = cli
    monkeypatch.setattr(mod, "PROXY_TOKEN_HASH", "")
    assert c.get("/v1/projects", headers=h()).status_code == 503
