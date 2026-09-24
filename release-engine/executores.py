"""
Executores reais do release engine: banco e imagem.

Implementam a mesma interface (fazer_backup / aplicar / verificar_saude /
reverter) que a maquina de estados injeta. A maquina nao sabe a diferenca.

A assimetria da taxonomia vive aqui:
  - BANCO: backup = pg_dump --schema; reverter = restaurar o dump. So seguro
    para migracao AUTO (aditiva, superficie nova/nao-usada). Migracao MANUAL
    nunca chega neste executor sem aprovacao previa.
  - IMAGEM: backup = a tag anterior (ja imutavel); reverter = repointar a tag.
    Lossless por natureza — dado vive no volume, nao na imagem.

NENHUM segredo passa pelo contexto de um agente: DSN e chaves vem do ambiente
do processo (definido pelo humano no painel), nunca de parametro de API.
"""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import httpx

# --------------------------------------------------------------------------
# Executor de BANCO (migracao)
# --------------------------------------------------------------------------

BACKUP_DIR = Path(os.environ.get("RELEASE_BACKUP_DIR", "/opt/data/release-backups"))


class ExecutorBanco:
    """Aplica um .sql num schema, com backup pg_dump e restore.

    dsn         : conexao de superusuario (so o release engine a tem; nunca a
                  role de cliente, que nao pode alterar schema).
    schema      : schema alvo da migracao.
    sql_path    : caminho do arquivo de migracao (do repo, assado na imagem).
    health_dsn  : conexao usada pelo health check (a role do CLIENTE — prova
                  que o isolamento continua de pe apos a migracao).
    """
    def __init__(self, dsn: str, schema: str, sql_path: Path, health_dsn: str | None = None):
        self.dsn = dsn
        self.schema = schema
        self.sql_path = Path(sql_path)
        self.health_dsn = health_dsn

    def _psql(self, *args: str, dsn: str | None = None, input_: str | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["psql", dsn or self.dsn, "-v", "ON_ERROR_STOP=1", *args],
            capture_output=True, text=True, timeout=120,
            input=input_, check=False,
        )

    def fazer_backup(self) -> str:
        """pg_dump apenas do schema alvo. Restaurar um schema nao derruba os outros."""
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ref = str(BACKUP_DIR / f"{self.schema}-{int(time.time())}.dump")
        # formato custom (-Fc): restauravel com pg_restore, comprimido.
        out = subprocess.run(
            ["pg_dump", self.dsn, "--schema", self.schema, "-Fc", "-f", ref],
            capture_output=True, text=True, timeout=300, check=False,
        )
        if out.returncode != 0:
            raise RuntimeError(f"pg_dump falhou: {out.stderr[:500]}")
        return ref

    def aplicar(self) -> None:
        sql = self.sql_path.read_text(encoding="utf-8")
        # a migracao roda numa transacao com search_path no schema alvo, igual
        # ao migrate.sh. Uma migracao que falha nao deixa schema pela metade.
        envelope = f"BEGIN;\nSET LOCAL search_path = {self.schema};\n{sql}\nCOMMIT;\n"
        r = self._psql("-f", "-", input_=envelope)
        if r.returncode != 0:
            raise RuntimeError(f"aplicar migracao falhou: {r.stderr[:500]}")

    def verificar_saude(self) -> bool:
        """Health: o banco responde E (se health_dsn) a role do cliente ainda
        conecta e enxerga o proprio schema. Migracao que quebra o isolamento
        ou o login do cliente NAO deve consolidar."""
        r = self._psql("-c", "SELECT 1")
        if r.returncode != 0:
            return False
        if self.health_dsn:
            r2 = self._psql("-c", f"SELECT 1 FROM information_schema.schemata WHERE schema_name = '{self.schema}'",
                            dsn=self.health_dsn)
            if r2.returncode != 0:
                return False
        return True

    def reverter(self, backup_ref: str) -> None:
        """Restaura o schema a partir do dump. --clean derruba os objetos novos
        antes de recriar o estado anterior. So chamado para migracao AUTO."""
        out = subprocess.run(
            ["pg_restore", "--dbname", self.dsn, "--schema", self.schema,
             "--clean", "--if-exists", "--no-owner", backup_ref],
            capture_output=True, text=True, timeout=300, check=False,
        )
        # pg_restore emite avisos benignos em stderr mesmo com sucesso; falha
        # real e' returncode != 0.
        if out.returncode != 0:
            raise RuntimeError(f"pg_restore falhou: {out.stderr[:500]}")


# --------------------------------------------------------------------------
# Executor de IMAGEM (deploy) — o "deployer" de escopo ESTREITO (opcao A)
# --------------------------------------------------------------------------
#
# Isolado do easypanel-proxy de proposito: o proxy e' read-only por invariante
# (a funcao de mutacao nao existe). Este deployer detem a UNICA capacidade de
# escrita no EasyPanel, e so estes verbos, so para servicos conhecidos. Ele
# NAO e' exposto ao agente: so a panel-api o chama, e so por clique humano.

# Allowlist de servicos que o deployer pode tocar. Fora disso, recusa.
SERVICOS_CONHECIDOS = {
    s.strip() for s in os.environ.get("DEPLOYER_SERVICOS", "").split(",") if s.strip()
}

# Allowlist de procedures de escrita. TRES, e mais nada.
PROCEDURES_DEPLOY = frozenset({
    "updateAppSourceImage",   # troca a tag da imagem
    "updateAppDeploy",        # persiste o command/deploy config
    "deployAppService",       # dispara o redeploy
})


class ExecutorImagem:
    """Repointa a tag de um servico no EasyPanel e redeploya.

    projeto/servico : identificam o servico (tem que estar em SERVICOS_CONHECIDOS).
    tag_nova        : imagem a aplicar (ex.: ghcr.io/.../hermes-whitelabel:sha-XXXX).
    tag_atual       : a que esta rodando agora = o backup (repointar de volta).
    health_url      : URL publica do servico; 200 = saudavel.
    """
    def __init__(self, projeto: str, servico: str, tag_nova: str, tag_atual: str,
                 health_url: str):
        chave = f"{projeto}/{servico}"
        if chave not in SERVICOS_CONHECIDOS:
            raise RuntimeError(f"servico '{chave}' fora da allowlist do deployer")
        self.projeto = projeto
        self.servico = servico
        self.tag_nova = tag_nova
        self.tag_atual = tag_atual
        self.health_url = health_url
        self._url = os.environ.get("EASYPANEL_URL", "").rstrip("/")
        self._key = os.environ.get("EASYPANEL_DEPLOY_KEY", "")

    def _chamar(self, procedure: str, payload: dict) -> None:
        if procedure not in PROCEDURES_DEPLOY:
            raise RuntimeError(f"procedure '{procedure}' nao permitida ao deployer")
        if not self._url or not self._key:
            raise RuntimeError("deployer sem EASYPANEL_URL/EASYPANEL_DEPLOY_KEY")
        r = httpx.post(f"{self._url}/api/{procedure}",
                       json=payload,
                       headers={"Authorization": f"Bearer {self._key}"},
                       timeout=60)
        if r.status_code >= 400:
            # nunca ecoa o corpo: pode conter a chave
            raise RuntimeError(f"EasyPanel respondeu {r.status_code} em {procedure}")

    def _aplicar_tag(self, tag: str) -> None:
        base = {"projectName": self.projeto, "serviceName": self.servico}
        self._chamar("updateAppSourceImage", {**base, "image": tag})
        self._chamar("deployAppService", base)

    def fazer_backup(self) -> str:
        """A tag atual JA e' o backup — imutavel no registry. So a registramos."""
        return self.tag_atual

    def aplicar(self) -> None:
        self._aplicar_tag(self.tag_nova)

    def verificar_saude(self) -> bool:
        """Espera o servico responder 200 na health_url (com algumas tentativas,
        porque o redeploy leva alguns segundos)."""
        for _ in range(30):
            try:
                if httpx.get(self.health_url, timeout=10).status_code == 200:
                    return True
            except httpx.HTTPError:
                pass
            time.sleep(4)
        return False

    def reverter(self, backup_ref: str) -> None:
        """Repointa para a tag anterior. Lossless: dado vive no volume."""
        self._aplicar_tag(backup_ref)
