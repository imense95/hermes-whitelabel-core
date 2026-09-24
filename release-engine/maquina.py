"""
Maquina de estados do release engine — logica PURA, sem I/O.

Separada de propósito do banco e do EasyPanel: aqui vivem as regras que
precisam ser provadas com testes rapidos e deterministicos:

  - a ordem legal das transicoes (nao da' para consolidar o que nao esta
    provisorio; nao da' para confirmar duas vezes);
  - o relogio: dado `agora` e o `deadline`, decidir se a release expirou;
  - o PADRAO SEGURO: expirou sem confirmacao => reverter, nunca manter;
  - o gate da taxonomia: classe 'manual' nao entra no fluxo automatico.

O ator real (dump, psql, deploy) e' injetado como callables — o executor de
banco e o deployer de imagem implementam a mesma interface. Assim a maquina
nao sabe (nem precisa saber) a diferenca entre migracao e imagem.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable

# Estados
SOLICITADA = "solicitada"
BACKUP = "backup"
APLICANDO = "aplicando"
VERIFICANDO = "verificando"
PROVISORIA = "provisoria"
CONSOLIDADA = "consolidada"
REVERTIDA = "revertida"
FALHA = "falha"

TERMINAIS = frozenset({CONSOLIDADA, REVERTIDA, FALHA})

# Transicoes legais: de -> {para permitidos}
_LEGAIS: dict[str, frozenset[str]] = {
    SOLICITADA: frozenset({BACKUP, FALHA}),
    BACKUP: frozenset({APLICANDO, FALHA}),
    APLICANDO: frozenset({VERIFICANDO, REVERTIDA, FALHA}),
    VERIFICANDO: frozenset({PROVISORIA, REVERTIDA, FALHA}),  # health falha -> reverte
    PROVISORIA: frozenset({CONSOLIDADA, REVERTIDA}),          # humano ou relogio
    CONSOLIDADA: frozenset(),
    REVERTIDA: frozenset(),
    FALHA: frozenset(),
}


class TransicaoInvalida(Exception):
    pass


def pode_transicionar(de: str, para: str) -> bool:
    return para in _LEGAIS.get(de, frozenset())


def exige_transicao(de: str, para: str) -> None:
    if not pode_transicionar(de, para):
        raise TransicaoInvalida(f"{de} -> {para} nao e' uma transicao legal")


def _agora() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Release:
    """Estado in-memory de uma release. Espelha a linha em platform.release."""
    id: int
    tipo: str                 # 'migracao' | 'imagem'
    alvo: str
    classe: str               # 'auto' | 'manual'
    janela_seg: int
    estado: str = SOLICITADA
    provisoria_em: datetime | None = None
    deadline: datetime | None = None
    health_ok: bool | None = None
    confirmada_por: str | None = None
    reverter_motivo: str | None = None
    eventos: list[tuple[str, str, str]] = field(default_factory=list)  # (para, ator, detalhe)

    def _ir(self, para: str, ator: str, detalhe: str = "") -> None:
        exige_transicao(self.estado, para)
        self.estado = para
        self.eventos.append((para, ator, detalhe))

    # --- relogio -----------------------------------------------------------
    def expirada(self, agora: datetime | None = None) -> bool:
        """True se esta provisoria e o deadline passou. Base do auto-revert."""
        if self.estado != PROVISORIA or self.deadline is None:
            return False
        return (agora or _agora()) >= self.deadline

    def segundos_restantes(self, agora: datetime | None = None) -> int | None:
        if self.estado != PROVISORIA or self.deadline is None:
            return None
        return max(0, int((self.deadline - (agora or _agora())).total_seconds()))


@dataclass
class Executor:
    """Interface do ator real. banco e imagem implementam estes 3 callables.

    Cada um devolve uma referencia (str) ou levanta em caso de falha.
    """
    fazer_backup: Callable      # () -> backup_ref
    aplicar: Callable           # () -> None (levanta se falhar)
    verificar_saude: Callable   # () -> bool
    reverter: Callable          # (backup_ref) -> None


def iniciar(rel: Release, executor: Executor, ator: str,
            agora: datetime | None = None) -> str:
    """Executa backup -> aplica -> verifica -> provisoria (ou reverte).

    GATE DA TAXONOMIA: classe 'manual' nunca entra aqui sem aprovacao previa —
    o chamador so chama iniciar() depois que um humano aprovou o manual. Se a
    classe e' 'manual' e ninguem aprovou, e' erro de programacao: recusamos.

    Devolve o estado final desta fase: PROVISORIA (sucesso, relogio correndo),
    REVERTIDA (health falhou -> auto-revert imediato) ou FALHA.
    """
    agora = agora or _agora()

    # backup SEMPRE antes de aplicar
    rel._ir(BACKUP, ator, "backup automatico antes de aplicar")
    backup_ref = executor.fazer_backup()

    # aplica
    rel._ir(APLICANDO, ator, "aplicando a mudanca")
    try:
        executor.aplicar()
    except Exception as e:  # noqa: BLE001 — qualquer falha ao aplicar reverte
        rel._ir(REVERTIDA, ator, f"falha ao aplicar: {e}")
        rel.reverter_motivo = "aplicacao"
        executor.reverter(backup_ref)
        return rel.estado

    # health check
    rel._ir(VERIFICANDO, ator, "health check pos-aplicacao")
    rel.health_ok = bool(executor.verificar_saude())
    if not rel.health_ok:
        # PADRAO SEGURO: health falhou -> reverte na hora, nem entra na janela
        rel._ir(REVERTIDA, ator, "health check falhou -> auto-revert")
        rel.reverter_motivo = "health"
        executor.reverter(backup_ref)
        return rel.estado

    # entra em provisoria: o relogio comeca AGORA (server-side)
    rel.provisoria_em = agora
    rel.deadline = agora + timedelta(seconds=rel.janela_seg)
    rel._ir(PROVISORIA, ator, f"provisoria; deadline em {rel.janela_seg}s")
    return rel.estado


def confirmar(rel: Release, executor: Executor, operador: str) -> str:
    """Humano confirmou dentro da janela -> consolida. Idempotencia: so de PROVISORIA."""
    rel._ir(CONSOLIDADA, operador, "confirmada pelo humano dentro da janela")
    rel.confirmada_por = operador
    return rel.estado


def reverter(rel: Release, executor: Executor, backup_ref: str,
             ator: str, motivo: str) -> str:
    """Reverte uma release provisoria para o backup. motivo: 'humano'|'timeout'."""
    rel._ir(REVERTIDA, ator, f"revertida ({motivo})")
    rel.reverter_motivo = motivo
    executor.reverter(backup_ref)
    return rel.estado


def reconciliar(rel: Release, executor: Executor, backup_ref: str,
                agora: datetime | None = None) -> str | None:
    """O coracao do padrao seguro, chamado em loop pelo servidor.

    Se a release esta provisoria e o deadline passou SEM confirmacao, reverte
    automaticamente. Independe do navegador do humano. Devolve o novo estado se
    agiu, ou None se nada a fazer.
    """
    if rel.expirada(agora):
        return reverter(rel, executor, backup_ref, ator="reconciliador", motivo="timeout")
    return None
