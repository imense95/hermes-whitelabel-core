"""
Testes da maquina de estados e do classificador. Sem I/O, sem banco.

O foco: provar as invariantes de seguranca do release engine —
- backup vem antes de aplicar, sempre;
- health falho reverte na hora (nem entra na janela);
- deadline sem confirmacao => auto-revert pelo reconciliador (padrao seguro);
- confirmar so vale de PROVISORIA, e uma vez;
- destrutivo classifica como manual (nao entra no automatico).
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import maquina as m  # noqa: E402
from classificador import classificar_migracao  # noqa: E402

T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


class ExecutorFake:
    """Registra a ordem das chamadas para as assercoes."""
    def __init__(self, health=True, aplicar_erro=False):
        self.chamadas: list[str] = []
        self._health = health
        self._aplicar_erro = aplicar_erro

    def fazer_backup(self):
        self.chamadas.append("backup")
        return "backup-ref-123"

    def aplicar(self):
        self.chamadas.append("aplicar")
        if self._aplicar_erro:
            raise RuntimeError("boom")

    def verificar_saude(self):
        self.chamadas.append("verificar")
        return self._health

    def reverter(self, backup_ref):
        self.chamadas.append(f"reverter({backup_ref})")


def _rel(tipo="migracao", classe="auto", janela=1800):
    return m.Release(id=1, tipo=tipo, alvo="urban", classe=classe, janela_seg=janela)


def _exec(**kw):
    fake = ExecutorFake(**kw)
    ex = m.Executor(fake.fazer_backup, fake.aplicar, fake.verificar_saude, fake.reverter)
    return ex, fake


# --- caminho feliz --------------------------------------------------------

def test_iniciar_leva_a_provisoria_com_relogio():
    rel = _rel(janela=1800)
    ex, fake = _exec()
    estado = m.iniciar(rel, ex, ator="herbert", agora=T0)
    assert estado == m.PROVISORIA
    # backup ANTES de aplicar, e verificar depois
    assert fake.chamadas == ["backup", "aplicar", "verificar"]
    assert rel.provisoria_em == T0
    assert rel.deadline == T0 + timedelta(seconds=1800)
    assert rel.health_ok is True


def test_confirmar_dentro_da_janela_consolida():
    rel = _rel()
    ex, fake = _exec()
    m.iniciar(rel, ex, ator="herbert", agora=T0)
    estado = m.confirmar(rel, ex, operador="herbert")
    assert estado == m.CONSOLIDADA
    assert rel.confirmada_por == "herbert"
    # consolidar NAO chama reverter
    assert not any("reverter" in c for c in fake.chamadas)


# --- padrao seguro: reverter ---------------------------------------------

def test_health_falho_reverte_na_hora_sem_entrar_na_janela():
    rel = _rel()
    ex, fake = _exec(health=False)
    estado = m.iniciar(rel, ex, ator="herbert", agora=T0)
    assert estado == m.REVERTIDA
    assert rel.reverter_motivo == "health"
    assert rel.deadline is None          # nunca entrou na janela
    assert fake.chamadas == ["backup", "aplicar", "verificar", "reverter(backup-ref-123)"]


def test_falha_ao_aplicar_reverte():
    rel = _rel()
    ex, fake = _exec(aplicar_erro=True)
    estado = m.iniciar(rel, ex, ator="herbert", agora=T0)
    assert estado == m.REVERTIDA
    assert rel.reverter_motivo == "aplicacao"
    assert "verificar" not in fake.chamadas       # nem chegou ao health
    assert fake.chamadas[-1] == "reverter(backup-ref-123)"


def test_reconciliador_reverte_no_deadline_sem_confirmacao():
    """O coracao: passou o deadline, ninguem confirmou -> auto-revert."""
    rel = _rel(janela=1800)
    ex, fake = _exec()
    m.iniciar(rel, ex, ator="herbert", agora=T0)

    # 1s antes do deadline: reconciliador nao faz nada
    quase = T0 + timedelta(seconds=1799)
    assert m.reconciliar(rel, ex, "backup-ref-123", agora=quase) is None
    assert rel.estado == m.PROVISORIA

    # no deadline: reverte
    depois = T0 + timedelta(seconds=1800)
    estado = m.reconciliar(rel, ex, "backup-ref-123", agora=depois)
    assert estado == m.REVERTIDA
    assert rel.reverter_motivo == "timeout"
    assert fake.chamadas[-1] == "reverter(backup-ref-123)"


def test_reconciliador_nao_reverte_se_ja_confirmada():
    rel = _rel()
    ex, fake = _exec()
    m.iniciar(rel, ex, ator="herbert", agora=T0)
    m.confirmar(rel, ex, operador="herbert")
    # muito depois do que seria o deadline: nada acontece, ja consolidou
    tarde = T0 + timedelta(days=1)
    assert m.reconciliar(rel, ex, "backup-ref-123", agora=tarde) is None
    assert rel.estado == m.CONSOLIDADA


def test_segundos_restantes_conta_do_servidor():
    rel = _rel(janela=1800)
    ex, _ = _exec()
    m.iniciar(rel, ex, ator="herbert", agora=T0)
    assert rel.segundos_restantes(agora=T0 + timedelta(seconds=600)) == 1200
    assert rel.segundos_restantes(agora=T0 + timedelta(seconds=5000)) == 0  # nunca negativo


# --- transicoes ilegais ---------------------------------------------------

def test_nao_consolida_o_que_nao_esta_provisorio():
    rel = _rel()
    ex, _ = _exec()
    with pytest.raises(m.TransicaoInvalida):
        m.confirmar(rel, ex, operador="herbert")   # ainda em 'solicitada'


def test_nao_confirma_duas_vezes():
    rel = _rel()
    ex, _ = _exec()
    m.iniciar(rel, ex, ator="herbert", agora=T0)
    m.confirmar(rel, ex, operador="herbert")
    with pytest.raises(m.TransicaoInvalida):
        m.confirmar(rel, ex, operador="herbert")    # ja consolidada


def test_janela_curta_imagem_vs_longa_migracao():
    """Regra: imagem = 1800s (30min); migracao aditiva = longa."""
    img = _rel(tipo="imagem", janela=1800)
    mig = _rel(tipo="migracao", janela=6 * 3600)
    ex, _ = _exec()
    m.iniciar(img, ex, ator="h", agora=T0)
    m.iniciar(mig, ex, ator="h", agora=T0)
    assert img.deadline == T0 + timedelta(minutes=30)
    assert mig.deadline == T0 + timedelta(hours=6)


# --- gate da taxonomia (classificador) ------------------------------------

def test_pr1_classifica_como_auto():
    sql = (Path(__file__).resolve().parents[2]
           / "infra/db/init/04-skills-registry-prod.sql").read_text(encoding="utf-8")
    c = classificar_migracao(sql)
    assert c.classe == "auto", c.motivos
    assert c.statements > 0


@pytest.mark.parametrize("sql,esperado", [
    ("CREATE TABLE x(a int);", "auto"),
    ("ALTER TABLE x ADD COLUMN b text;", "auto"),
    ("ALTER TABLE x ADD COLUMN b text NOT NULL;", "manual"),
    ("ALTER TABLE x ADD COLUMN b text NOT NULL DEFAULT 'z';", "auto"),
    ("ALTER TABLE x DROP COLUMN b;", "manual"),
    ("ALTER TABLE x ALTER COLUMN b TYPE int;", "manual"),
    ("ALTER TABLE x ALTER COLUMN b SET NOT NULL;", "manual"),
    ("ALTER TABLE x ADD CONSTRAINT u UNIQUE (a);", "manual"),
    ("ALTER TABLE x ADD CONSTRAINT k CHECK (a > 0);", "auto"),
    ("DROP TABLE x;", "manual"),
    ("TRUNCATE x;", "manual"),
    ("DELETE FROM x WHERE a=1;", "manual"),
    ("UPDATE x SET a=2;", "manual"),
    ("CREATE INDEX i ON x(a);", "auto"),
    ("GRANT SELECT ON x TO r;", "auto"),
    ("CREATE TABLE y(a int); DROP TABLE x;", "manual"),
])
def test_classificacao_da_taxonomia(sql, esperado):
    assert classificar_migracao(sql).classe == esperado


def test_sql_invalido_levanta():
    with pytest.raises(ValueError):
        classificar_migracao("ISSO NAO E SQL {{{")
