"""
Persistencia das releases. Duas implementacoes, uma interface (Protocol):

  - RepoMemoria  : dict em memoria; usada nos testes rapidos e como fallback dev.
  - RepoPostgres : grava em platform.release / platform.release_evento (psycopg).

A interface guarda SO o estado duravel (a linha da release e a trilha de
eventos). O wiring do executor (dump/psql/deploy) e' runtime, vive noutro lugar
(RegistroExecutores no app) — executor nao serializa.

Regra do produto refletida aqui: sem relogio. Nada de janela_seg/deadline.
Uma release provisoria fica aguardando aprovacao humana sem prazo.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable

import maquina as m


def _agora() -> datetime:
    return datetime.now(timezone.utc)


@runtime_checkable
class Repo(Protocol):
    """Interface de persistencia. RepoMemoria e RepoPostgres a implementam."""

    def criar(self, *, tipo: str, alvo: str, classe: str, descricao: str,
              solicitada_por: str, motivos: list[str], avisos: list[str],
              payload_ref: str | None) -> m.Release: ...

    def get(self, rid: int) -> m.Release | None: ...

    def listar(self, estados: list[str] | None = None) -> list[m.Release]: ...

    def salvar(self, rel: m.Release) -> None:
        """Persiste o estado atual da release e os eventos ainda nao gravados."""
        ...


# --------------------------------------------------------------------------
# Memoria
# --------------------------------------------------------------------------
class RepoMemoria:
    def __init__(self) -> None:
        self._rel: dict[int, m.Release] = {}
        self._seq = 0

    def criar(self, *, tipo, alvo, classe, descricao, solicitada_por,
              motivos, avisos, payload_ref) -> m.Release:
        self._seq += 1
        rel = m.Release(
            id=self._seq, tipo=tipo, alvo=alvo, classe=classe,
            descricao=descricao, solicitada_por=solicitada_por,
            motivos=list(motivos), avisos=list(avisos), payload_ref=payload_ref,
        )
        self._rel[rel.id] = rel
        return rel

    def get(self, rid: int) -> m.Release | None:
        return self._rel.get(rid)

    def listar(self, estados: list[str] | None = None) -> list[m.Release]:
        rels = list(self._rel.values())
        if estados is not None:
            rels = [r for r in rels if r.estado in estados]
        return rels

    def salvar(self, rel: m.Release) -> None:
        # em memoria o objeto ja e' o mesmo; so marca os eventos como gravados
        rel.eventos_persistidos = len(rel.eventos)


# --------------------------------------------------------------------------
# Postgres
# --------------------------------------------------------------------------
_COLS = (
    "id, tipo, alvo, descricao, classe, motivos, avisos, estado, payload_ref, "
    "backup_ref, health_ok, aguardando_desde, solicitada_por, confirmada_por, "
    "confirmada_em, revertida_em, reverter_motivo"
)


def _row_para_release(row: tuple) -> m.Release:
    (rid, tipo, alvo, descricao, classe, motivos, avisos, estado, payload_ref,
     backup_ref, health_ok, aguardando_desde, solicitada_por, confirmada_por,
     confirmada_em, revertida_em, reverter_motivo) = row
    rel = m.Release(
        id=rid, tipo=tipo, alvo=alvo, classe=classe, estado=estado,
        aguardando_desde=aguardando_desde, health_ok=health_ok,
        confirmada_por=confirmada_por, reverter_motivo=reverter_motivo,
        descricao=descricao, solicitada_por=solicitada_por,
        payload_ref=payload_ref, backup_ref=backup_ref,
        motivos=list(motivos or []), avisos=list(avisos or []),
    )
    rel.confirmada_em = confirmada_em
    rel.revertida_em = revertida_em
    # os eventos vivos nao sao recarregados do banco; contamos os ja gravados
    # ao (re)hidratar, para que salvar() so anexe os novos desta sessao.
    return rel


class RepoPostgres:
    """Grava em platform.release / platform.release_evento.

    Recebe uma factory de conexao (callable -> conexao psycopg) para nao acoplar
    a criacao/pool. Cada operacao usa uma conexao curta com commit.
    """

    def __init__(self, conectar) -> None:
        self._conectar = conectar

    # -- leitura ------------------------------------------------------------
    def get(self, rid: int) -> m.Release | None:
        with self._conectar() as con, con.cursor() as cur:
            cur.execute(f"SELECT {_COLS} FROM platform.release WHERE id = %s", (rid,))
            row = cur.fetchone()
        if row is None:
            return None
        rel = _row_para_release(row)
        rel.eventos_persistidos = self._contar_eventos(rid)
        return rel

    def listar(self, estados: list[str] | None = None) -> list[m.Release]:
        sql = f"SELECT {_COLS} FROM platform.release"
        params: tuple = ()
        if estados is not None:
            sql += " WHERE estado = ANY(%s)"
            params = (estados,)
        sql += " ORDER BY id"
        with self._conectar() as con, con.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return [_row_para_release(r) for r in rows]

    def _contar_eventos(self, rid: int) -> int:
        with self._conectar() as con, con.cursor() as cur:
            cur.execute("SELECT count(*) FROM platform.release_evento WHERE release_id = %s", (rid,))
            (n,) = cur.fetchone()
        return int(n)

    # -- escrita ------------------------------------------------------------
    def criar(self, *, tipo, alvo, classe, descricao, solicitada_por,
              motivos, avisos, payload_ref) -> m.Release:
        with self._conectar() as con:
            with con.cursor() as cur:
                cur.execute(
                    "INSERT INTO platform.release "
                    "(tipo, alvo, descricao, classe, motivos, avisos, estado, "
                    " payload_ref, solicitada_por) "
                    "VALUES (%s,%s,%s,%s,%s,%s,'solicitada',%s,%s) RETURNING id",
                    (tipo, alvo, descricao, classe, json.dumps(list(motivos)),
                     json.dumps(list(avisos)), payload_ref, solicitada_por),
                )
                (rid,) = cur.fetchone()
            con.commit()
        rel = m.Release(
            id=rid, tipo=tipo, alvo=alvo, classe=classe,
            descricao=descricao, solicitada_por=solicitada_por,
            motivos=list(motivos), avisos=list(avisos), payload_ref=payload_ref,
        )
        return rel

    def salvar(self, rel: m.Release) -> None:
        """UPDATE da linha + INSERT dos eventos ainda nao gravados. Atomico."""
        novos = rel.eventos[rel.eventos_persistidos:]
        # de_estado de cada evento novo = para_estado do evento anterior
        anteriores = rel.eventos[:rel.eventos_persistidos]
        de = anteriores[-1][0] if anteriores else None
        with self._conectar() as con:
            with con.cursor() as cur:
                cur.execute(
                    "UPDATE platform.release SET estado=%s, payload_ref=%s, "
                    "backup_ref=%s, health_ok=%s, aguardando_desde=%s, "
                    "confirmada_por=%s, confirmada_em=%s, revertida_em=%s, "
                    "reverter_motivo=%s, atualizado_em=now() WHERE id=%s",
                    (rel.estado, rel.payload_ref, rel.backup_ref, rel.health_ok,
                     rel.aguardando_desde, rel.confirmada_por,
                     getattr(rel, "confirmada_em", None),
                     getattr(rel, "revertida_em", None),
                     rel.reverter_motivo, rel.id),
                )
                for (para, ator, detalhe) in novos:
                    cur.execute(
                        "INSERT INTO platform.release_evento "
                        "(release_id, de_estado, para_estado, ator, detalhe) "
                        "VALUES (%s,%s,%s,%s,%s)",
                        (rel.id, de, para, ator, detalhe),
                    )
                    de = para
            con.commit()
        rel.eventos_persistidos = len(rel.eventos)
