"""
Testes do RepoPostgres contra um Postgres REAL.

Pulados quando RELEASE_TEST_DSN nao esta setado (dev sem banco). No CI, um
service container postgres:16 fornece o DSN e aplica 04+05 antes — entao aqui
provamos: criar release, salvar transicoes, recarregar do banco, e a trilha
append-only de eventos. Isto e' o que o RepoMemoria nao consegue garantir:
que o SQL real (colunas, tipos, constraints) casa com o codigo.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DSN = os.environ.get("RELEASE_TEST_DSN", "")
pytestmark = pytest.mark.skipif(not DSN, reason="RELEASE_TEST_DSN ausente (sem Postgres real)")


@pytest.fixture()
def repo():
    import psycopg  # noqa: PLC0415
    import repo as repo_mod  # noqa: PLC0415

    def conectar():
        return psycopg.connect(DSN)

    # limpa a tabela entre testes (as tabelas ja existem: 04+05 aplicados no CI)
    with conectar() as con, con.cursor() as cur:
        cur.execute("DELETE FROM platform.release_evento")
        cur.execute("DELETE FROM platform.release")
        con.commit()
    return repo_mod.RepoPostgres(conectar)


def _criar(repo, **kw):
    base = dict(tipo="migracao", alvo="urban", classe="auto",
                descricao="Nova area de skills", solicitada_por="herbert",
                motivos=[], avisos=[], payload_ref="/opt/x/04.sql")
    base.update(kw)
    return repo.criar(**base)


def test_criar_persiste_e_recarrega(repo):
    rel = _criar(repo)
    assert rel.id > 0
    recarregado = repo.get(rel.id)
    assert recarregado is not None
    assert recarregado.descricao == "Nova area de skills"
    assert recarregado.estado == "solicitada"
    assert recarregado.classe == "auto"
    assert recarregado.payload_ref == "/opt/x/04.sql"


def test_salvar_persiste_estado_e_eventos(repo):
    import maquina as m  # noqa: PLC0415
    rel = _criar(repo)

    # simula transicoes da maquina
    rel._ir(m.BACKUP, "herbert", "backup")
    rel.backup_ref = "/bk/urban-1.dump"
    rel._ir(m.APLICANDO, "herbert", "aplicando")
    rel._ir(m.VERIFICANDO, "herbert", "verificando")
    rel.health_ok = True
    rel._ir(m.PROVISORIA, "herbert", "aguardando")
    repo.salvar(rel)

    r2 = repo.get(rel.id)
    assert r2.estado == "provisoria"
    assert r2.backup_ref == "/bk/urban-1.dump"
    assert r2.health_ok is True

    # a trilha tem os 4 eventos, com de_estado encadeado
    import psycopg  # noqa: PLC0415
    with psycopg.connect(DSN) as con, con.cursor() as cur:
        cur.execute("SELECT de_estado, para_estado, ator FROM platform.release_evento "
                    "WHERE release_id=%s ORDER BY id", (rel.id,))
        eventos = cur.fetchall()
    assert [e[1] for e in eventos] == ["backup", "aplicando", "verificando", "provisoria"]
    assert eventos[0][0] is None            # primeiro nao tem de_estado
    assert eventos[1][0] == "backup"        # encadeado
    assert all(e[2] == "herbert" for e in eventos)


def test_salvar_e_idempotente_nao_duplica_eventos(repo):
    import maquina as m  # noqa: PLC0415
    rel = _criar(repo)
    rel._ir(m.BACKUP, "herbert", "backup")
    repo.salvar(rel)
    repo.salvar(rel)   # segunda chamada sem eventos novos
    import psycopg  # noqa: PLC0415
    with psycopg.connect(DSN) as con, con.cursor() as cur:
        cur.execute("SELECT count(*) FROM platform.release_evento WHERE release_id=%s", (rel.id,))
        (n,) = cur.fetchone()
    assert n == 1     # nao duplicou


def test_listar_filtra_por_estado(repo):
    a = _criar(repo, descricao="A")
    b = _criar(repo, descricao="B")
    import maquina as m  # noqa: PLC0415
    b._ir(m.BACKUP, "herbert", "x")
    repo.salvar(b)
    solicitadas = repo.listar(estados=["solicitada"])
    assert a.id in [r.id for r in solicitadas]
    assert b.id not in [r.id for r in solicitadas]


def test_uma_release_em_andamento_por_alvo(repo):
    """O indice unico parcial barra duas releases ativas no mesmo alvo."""
    import maquina as m  # noqa: PLC0415
    import psycopg  # noqa: PLC0415
    a = _criar(repo, alvo="urban")
    a._ir(m.BACKUP, "herbert", "x")
    repo.salvar(a)
    b = _criar(repo, alvo="urban")
    b._ir(m.BACKUP, "herbert", "x")
    with pytest.raises(psycopg.errors.UniqueViolation):
        repo.salvar(b)
