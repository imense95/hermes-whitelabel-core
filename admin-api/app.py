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
PLUGIN_CATALOG_DIR = Path(os.environ.get("PRODUCT_PLUGIN_CATALOG_DIR", "/opt/product/plugins"))
TENANT_SLUG = os.environ.get("TENANT_SLUG", "")
ADMIN_TOKEN_HASH = os.environ.get("ADMIN_API_TOKEN_SHA256", "")
AUDIT_DSN = os.environ.get("ADMIN_AUDIT_DSN", "")
# "db"   = producao: mutacao sem trilha no Postgres e' RECUSADA (default)
# "file" = dev/teste: trilha em arquivo basta. Nunca use em producao.
AUDIT_MODE = os.environ.get("ADMIN_AUDIT_MODE", "db")
IP_ALLOWLIST = [x.strip() for x in os.environ.get("ADMIN_API_IP_ALLOWLIST", "").split(",") if x.strip()]

# Diretorios que a API pode tocar. Tudo fora disso e' negado por construcao.
SKILLS_DIR = DATA_DIR / "skills"
PLUGINS_DIR = DATA_DIR / "plugins"
PROFILES_DIR = DATA_DIR / "profiles"   # skill universal nasce em profile proprio
CONFIG_FILE = DATA_DIR / "config.yaml"
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

AcaoAudit = Literal["skills.list", "skills.install", "skills.prepare",
                    "plugins.list", "plugins.install",
                    "logs.read", "status", "credentials.set"]


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

    # Nao faz INSERT direto: a Admin API conecta como a role do CLIENTE
    # (<slug>_app), que nao tem USAGE em platform — e nao deve ter, e' isso
    # que isola os schemas. A gravacao passa por uma funcao SECURITY DEFINER
    # (infra/db/init/03-admin-audit-prod.sql) que deriva o tenant_slug de
    # current_user. Consequencia: o slug enviado aqui e' ignorado pelo banco;
    # um container comprometido nao consegue auditar em nome de outro cliente.
    try:
        with psycopg.connect(AUDIT_DSN, connect_timeout=5) as conn:
            conn.execute(
                "SELECT platform.registrar_admin_audit(%s, %s, %s, %s, %s)",
                (registro["operador"], registro["acao"],
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


def _resolver_skill_no_catalogo(nome: str) -> Path | None:
    """Acha o diretorio de uma skill por NOME na arvore do catalogo.

    O catalogo passou a ser aninhado por ciclo de vida:
        universal/<nome>/SKILL.md
        clientes/<slug>/especificas/<nome>/SKILL.md
        clientes/<slug>/overlays/<nome>/        (delta; fatia futura de merge)
    Resolvemos pelo mesmo criterio da listagem (rglob de SKILL.md), casando o
    diretorio-folha com o nome pedido. Confinamento: o caminho resolvido tem
    que ficar sob CATALOG_DIR. Ambiguidade (mesmo nome em >1 lugar) e' erro
    explicito — a precedencia por cliente/overlay e' fatia posterior, nao um
    palpite silencioso aqui.
    """
    base = CATALOG_DIR.resolve()
    if not base.is_dir():
        return None
    achados = []
    for md in base.rglob("SKILL.md"):
        d = md.parent
        # overlays nao sao skills instalaveis inteiras: guardam so delta
        if d.name == nome and "overlays" not in d.relative_to(base).parts:
            r = d.resolve()
            if str(r).startswith(str(base) + os.sep):
                achados.append(r)
    achados = sorted(set(achados))
    if len(achados) > 1:
        raise HTTPException(
            409,
            f"skill '{nome}' aparece em mais de um lugar no catalogo: "
            + ", ".join(str(a.relative_to(base)) for a in achados)
            + " — resolucao por cliente ainda nao implementada",
        )
    return achados[0] if achados else None


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
    origem = _resolver_skill_no_catalogo(body.skill)
    # dupla checagem: regex no nome (no schema) + confinamento feito no resolver.
    # Tentativa recusada nao muda estado: registra, mas nao bloqueia a
    # resposta se a trilha estiver indisponivel.
    if origem is None:
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
# Verbo 2a — preparar skill em profile isolado (NAO ativa)
# --------------------------------------------------------------------------
#
# A regra do produto e': "toda skill universal nasce em profile proprio na
# instancia". install (verbo 2) copia so para o profile DEFAULT — nao isola.
# prepare replica a logica do ativar-marketing-profile.sh de forma generica,
# construindo profiles/<profile>/ com a skill, o plugin-dep e um .env proprio —
# e PARA ANTES DE ATIVAR. Ativar (reiniciar o gateway para o profile carregar)
# e' passo HUMANO, fora deste verbo. Estado resultante: "preparada".
#
# Isto encaixa no mecanismo de janela de confirmacao: preparar e' reversivel
# (apagar o dir do profile nao afeta nada em uso), ativar e' a consolidacao.

# Chaves que PODEM ser semeadas de /opt/data/.env para o .env do profile.
# Diferente de CREDENCIAIS_PERMITIDAS (o que a assessoria pode GRAVAR por HTTP):
# aqui o valor NUNCA cruza a rede — e' copiado de um arquivo local ja confiavel.
# Por isso DATABASE_URL entra (o profile precisa do banco), mas continua
# proibida de ser gravada por /v1/credentials.
CREDENCIAIS_SEED_PROFILE = {
    "DATABASE_URL",
    "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY",
    "GOOGLE_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY",
    "NANO_BANANA_API_KEY",
    "MARKETING_GOOGLE_CLIENT_ID", "MARKETING_GOOGLE_CLIENT_SECRET",
}


class PrepararSkill(BaseModel):
    skill: str = Field(min_length=2, max_length=64)
    # profile onde a skill nasce isolada; default = o proprio nome da skill
    profile: str | None = Field(default=None, max_length=64)
    # plugin do qual a skill depende (ex.: marketing-conteudo -> marketing).
    # vem do skill_meta (Postgres), que a panel-api conhece; a Admin API nao
    # consulta o catalogo curado, entao recebe por parametro.
    plugin_dep: str | None = Field(default=None, max_length=64)

    @field_validator("skill")
    @classmethod
    def _slug_skill(cls, v: str) -> str:
        if not SLUG_RE.match(v):
            raise ValueError("nome de skill invalido")
        return v

    @field_validator("profile", "plugin_dep")
    @classmethod
    def _slug_opt(cls, v: str | None) -> str | None:
        if v is not None and not SLUG_RE.match(v):
            raise ValueError("nome invalido")
        return v


def _semear_env_profile(destino_env: Path) -> tuple[list[str], list[str]]:
    """Cria o .env do profile: chaves seed copiadas do .env default (as que
    existem) + API_SERVER_KEY propria (cifra o refresh token do Drive; gerada
    aqui, nunca sai). Idempotente: nao sobrescreve o que ja existe.

    Devolve (semeadas, ausentes) — so NOMES, nunca valores.
    """
    default_env = _ler_env()  # /opt/data/.env
    destino_env.parent.mkdir(parents=True, exist_ok=True)
    atual: dict[str, str] = {}
    if destino_env.is_file():
        for linha in destino_env.read_text(encoding="utf-8", errors="replace").splitlines():
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, _, val = linha.partition("=")
                atual[k.strip()] = val.strip()

    semeadas, ausentes = [], []
    for chave in sorted(CREDENCIAIS_SEED_PROFILE):
        if chave in atual:
            continue
        valor = default_env.get(chave)
        if valor:
            atual[chave] = valor
            semeadas.append(chave)
        else:
            ausentes.append(chave)

    # chave propria do profile, so se ainda nao houver
    if "API_SERVER_KEY" not in atual:
        atual["API_SERVER_KEY"] = secrets.token_hex(32)
        semeadas.append("API_SERVER_KEY")

    tmp = destino_env.with_suffix(".env.tmp")
    conteudo = "\n".join(f"{k}={v}" for k, v in sorted(atual.items())) + "\n"
    tmp.write_text(conteudo, encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, destino_env)
    return semeadas, ausentes


@app.post("/v1/skills/prepare")
def preparar_skill(body: PrepararSkill, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    """Prepara uma skill universal em profile isolado, SEM ativar.

    Constroi profiles/<profile>/ com a skill (do catalogo assado), o plugin-dep
    (sem motor/, do catalogo de plugins) habilitado no config do profile, e um
    .env proprio. NAO reinicia o gateway: ativar e' passo humano. Reversivel
    por construcao — apagar o dir do profile desfaz sem tocar nada em uso.
    """
    origem = _resolver_skill_no_catalogo(body.skill)
    if origem is None:
        auditar(op.nome, "skills.prepare", body.skill, "erro", "skill fora do catalogo", obrigatorio=False)
        raise HTTPException(404, f"skill '{body.skill}' nao esta no catalogo do produto")

    profile = body.profile or body.skill
    prof_dir = PROFILES_DIR / profile
    # confinamento: o profile resolvido tem que ficar sob PROFILES_DIR
    if not str(prof_dir.resolve()).startswith(str(PROFILES_DIR.resolve()) + os.sep):
        raise HTTPException(400, "profile fora de profiles/")

    # plugin-dep tem que existir no catalogo ANTES de mexer em qualquer coisa
    origem_plugin = None
    if body.plugin_dep:
        origem_plugin = (PLUGIN_CATALOG_DIR / body.plugin_dep).resolve()
        if not str(origem_plugin).startswith(str(PLUGIN_CATALOG_DIR.resolve()) + os.sep) \
           or not (origem_plugin / "plugin.yaml").is_file():
            auditar(op.nome, "skills.prepare", f"{body.skill}:{body.plugin_dep}", "erro",
                    "plugin-dep fora do catalogo", obrigatorio=False)
            raise HTTPException(404, f"plugin '{body.plugin_dep}' nao esta no catalogo do produto")

    skill_dst = prof_dir / "skills" / body.skill
    ja_preparada = skill_dst.exists()

    # auditar ANTES de escrever: sem trilha, nada acontece
    auditar(op.nome, "skills.prepare",
            f"{body.skill} -> profile {profile}"
            + (f" (+plugin {body.plugin_dep})" if body.plugin_dep else "")
            + (" [re-preparo]" if ja_preparada else ""),
            "ok", obrigatorio=True)

    # 1. skill dentro do profile (re-preparo faz backup, como o install)
    skill_dst.parent.mkdir(parents=True, exist_ok=True)
    if ja_preparada:
        backup = prof_dir / "skills" / f".backup-{body.skill}-{int(time.time())}"
        shutil.move(str(skill_dst), str(backup))
    shutil.copytree(origem, skill_dst)

    # 2. plugin-dep dentro do profile (sem motor/) + habilita no config do profile
    plugin_info: dict[str, Any] | None = None
    if origem_plugin is not None and body.plugin_dep:
        plugin_dst = prof_dir / "plugins" / body.plugin_dep
        plugin_dst.parent.mkdir(parents=True, exist_ok=True)
        if plugin_dst.exists():
            shutil.move(str(plugin_dst),
                        str(prof_dir / "plugins" / f".backup-{body.plugin_dep}-{int(time.time())}"))
        shutil.copytree(origem_plugin, plugin_dst,
                        ignore=shutil.ignore_patterns(*PLUGIN_NAO_COPIAR))
        _habilitar_plugin_em(prof_dir / "config.yaml", body.plugin_dep)
        man = _ler_manifesto(plugin_dst)
        plugin_info = {"nome": body.plugin_dep, "versao": man.get("version"),
                       "ferramentas": man.get("provides_tools", [])}

    # 3. .env proprio do profile (seed do default + API_SERVER_KEY propria)
    semeadas, ausentes = _semear_env_profile(prof_dir / ".env")

    return {
        "skill": body.skill,
        "profile": profile,
        "estado": "preparada",
        "versao": _ler_versao(skill_dst),
        "plugin": plugin_info,
        "credenciais_semeadas": semeadas,   # so nomes, nunca valores
        "credenciais_ausentes": ausentes,   # o que faltou no .env default (checklist)
        "observacao": "profile preparado no disco. NAO ativado: reiniciar o "
                      "gateway para o profile carregar e' acao humana (consolidacao).",
    }


# --------------------------------------------------------------------------
# Verbo 2b — plugins (mesma regra das skills: so do catalogo assado na imagem)
# --------------------------------------------------------------------------
#
# Um plugin e' codigo Python carregado DENTRO do agente, entao vale a mesma
# postura: nunca upload, so copia da arvore root-owned da imagem. Diferente
# da skill, o Hermes so carrega plugin de usuario listado em
# `plugins.enabled` no config.yaml — entao instalar = copiar + habilitar.
#
# Motores Node dentro do plugin (ex.: marketing/motor com node_modules) NAO
# sao copiados para o volume: ficam na imagem (read-only) e o plugin os acha
# por /opt/product/plugins/<nome>/motor. O volume recebe so o manifesto e o
# codigo Python — pequeno, e o motor atualiza junto com a imagem.

PLUGIN_NAO_COPIAR = {"motor", "node_modules", "__pycache__", "test", "tests"}


def _ler_config_yaml_de(path: Path) -> dict[str, Any]:
    """Le um config.yaml sem depender de PyYAML completo: so o que precisamos.

    O arquivo e' do Hermes; nao reescrevemos o resto. Se nao existir ou nao
    parsear, tratamos como vazio e criamos so a chave plugins.enabled.
    """
    try:
        import yaml  # noqa: PLC0415
    except ImportError:  # pragma: no cover - requirements garantem
        raise HTTPException(500, "PyYAML ausente na Admin API")
    if not path.is_file():
        return {}
    try:
        dados = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        raise HTTPException(500, f"config.yaml ilegivel: {e}")
    return dados if isinstance(dados, dict) else {}


def _ler_config_yaml() -> dict[str, Any]:
    return _ler_config_yaml_de(CONFIG_FILE)


def _habilitar_plugin_em(path: Path, nome: str) -> bool:
    """Garante `plugins.enabled: [..., nome]` no config em `path`. True se mudou."""
    import yaml  # noqa: PLC0415
    cfg = _ler_config_yaml_de(path)
    plugins = cfg.setdefault("plugins", {})
    if not isinstance(plugins, dict):
        plugins = cfg["plugins"] = {}
    enabled = plugins.get("enabled")
    if not isinstance(enabled, list):
        enabled = []
    if nome in enabled:
        return False
    plugins["enabled"] = [*enabled, nome]
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".yaml.tmp")
    tmp.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")
    os.replace(tmp, path)
    return True


def _habilitar_plugin_no_config(nome: str) -> bool:
    """Garante `plugins.enabled: [..., nome]` no config do profile default."""
    return _habilitar_plugin_em(CONFIG_FILE, nome)


def _ler_manifesto(plugin_dir: Path) -> dict[str, Any]:
    try:
        import yaml  # noqa: PLC0415
        dados = yaml.safe_load((plugin_dir / "plugin.yaml").read_text(encoding="utf-8")) or {}
        return dados if isinstance(dados, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


@app.get("/v1/plugins")
def listar_plugins(op: Operador = Depends(autenticar)) -> dict[str, Any]:
    instalados = []
    if PLUGINS_DIR.is_dir():
        for m in sorted(PLUGINS_DIR.glob("*/plugin.yaml")):
            if m.parent.name.startswith("."):
                continue  # .backup-<nome>-<ts> de reinstalacao nao e' plugin ativo
            man = _ler_manifesto(m.parent)
            instalados.append({"nome": m.parent.name, "versao": man.get("version"),
                               "ferramentas": man.get("provides_tools", [])})
    habilitados = _ler_config_yaml().get("plugins", {}).get("enabled", []) if CONFIG_FILE.is_file() else []
    catalogo = sorted(p.parent.name for p in PLUGIN_CATALOG_DIR.glob("*/plugin.yaml"))         if PLUGIN_CATALOG_DIR.is_dir() else []
    auditar(op.nome, "plugins.list", f"{len(instalados)} instalados", "ok", obrigatorio=False)
    return {"instalados": instalados, "habilitados": habilitados if isinstance(habilitados, list) else [],
            "catalogo_disponivel": catalogo}


class InstalarPlugin(BaseModel):
    plugin: str = Field(min_length=2, max_length=64)

    @field_validator("plugin")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not SLUG_RE.match(v):
            raise ValueError("nome de plugin invalido")
        return v


@app.post("/v1/plugins/install")
def instalar_plugin(body: InstalarPlugin, op: Operador = Depends(autenticar)) -> dict[str, Any]:
    origem = (PLUGIN_CATALOG_DIR / body.plugin).resolve()
    if not str(origem).startswith(str(PLUGIN_CATALOG_DIR.resolve()) + os.sep):
        auditar(op.nome, "plugins.install", body.plugin, "erro", "fora do catalogo", obrigatorio=False)
        raise HTTPException(400, "plugin fora do catalogo")
    if not (origem / "plugin.yaml").is_file():
        auditar(op.nome, "plugins.install", body.plugin, "erro", "nao existe no catalogo", obrigatorio=False)
        raise HTTPException(404, f"plugin '{body.plugin}' nao esta no catalogo do produto")

    destino = PLUGINS_DIR / body.plugin
    ja_existia = destino.exists()
    auditar(op.nome, "plugins.install",
            f"{body.plugin} ({'atualizacao' if ja_existia else 'instalacao'})", "ok", obrigatorio=True)

    destino.parent.mkdir(parents=True, exist_ok=True)
    if ja_existia:
        shutil.move(str(destino), str(PLUGINS_DIR / f".backup-{body.plugin}-{int(time.time())}"))
    shutil.copytree(origem, destino, ignore=shutil.ignore_patterns(*PLUGIN_NAO_COPIAR))
    habilitou = _habilitar_plugin_no_config(body.plugin)

    man = _ler_manifesto(destino)
    return {
        "plugin": body.plugin,
        "acao": "atualizado" if ja_existia else "instalado",
        "versao": man.get("version"),
        "ferramentas": man.get("provides_tools", []),
        "habilitado_no_config": habilitou or body.plugin in (_ler_config_yaml().get("plugins", {}).get("enabled") or []),
        "observacao": "plugin carrega na proxima sessao do agente; reinicie o gateway para valer em canais ja abertos",
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
