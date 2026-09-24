"""
Maquina de estados do release engine — logica PURA, sem I/O.

Regra do produto (decisao do Herbert): NAO existe relogio de auto-reversao.
Uma release aplicada com sucesso entra em 'provisoria' e AGUARDA aprovacao
humana, sem prazo. Nada consolida e nada reverte sozinho pelo tempo — so por
acao humana (confirmar ou reverter). A unica reversao automatica e' quando a
propria aplicacao falha ou o health check nao passa: nesse caso a mudanca nao
subiu de verdade, entao voltamos ao backup na hora. Isso nao e' um relogio.

Aqui vivem as regras que precisam ser provadas com testes deterministicos:
  - a ordem legal das transicoes (nao da' para consolidar o que nao esta
    provisorio; nao da' para confirmar duas vezes);
  - o PADRAO SEGURO na aplicacao: aplicar falhou ou health falhou => reverter;
  - o gate da taxonomia: classe 'manual' nao entra no fluxo automatico.

O ator real (dump, psql, deploy) e' injetado como callables — o executor de
banco e o deployer de imagem implementam a mesma interface. Assim a maquina
nao sabe (nem precisa saber) a diferenca entre migracao e imagem.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

# Estados
SOLICITADA = "solicitada"
BACKUP = "backup"
APLICANDO = "aplicando"
VERIFICANDO = "verificando"
PROVISORIA = "provisoria"      # aplicada, aguardando aprovacao humana (SEM prazo)
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
    PROVISORIA: frozenset({CONSOLIDADA, REVERTIDA}),          # so acao humana
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
    estado: str = SOLICITADA
    aguardando_desde: datetime | None = None   # quando entrou em provisoria
    health_ok: bool | None = None
    confirmada_por: str | None = None
    confirmada_em: datetime | None = None
    revertida_em: datetime | None = None
    reverter_motivo: str | None = None         # 'humano' | 'health' | 'aplicacao'
    eventos: list[tuple[str, str, str]] = field(default_factory=list)  # (para, ator, detalhe)
    # --- metadados carregados/persistidos (a maquina nao os usa na logica) ---
    descricao: str = ""
    solicitada_por: str = ""
    payload_ref: str | None = None     # migracao: caminho do .sql; imagem: tag nova
    backup_ref: str | None = None      # migracao: caminho do dump; imagem: tag anterior
    motivos: list[str] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)
    eventos_persistidos: int = 0       # quantos eventos ja foram gravados

    def _ir(self, para: str, ator: str, detalhe: str = "") -> None:
        exige_transicao(self.estado, para)
        self.estado = para
        self.eventos.append((para, ator, detalhe))


@dataclass
class Executor:
    """Interface do ator real. banco e imagem implementam estes 4 callables.

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
    o chamador so chama iniciar() depois que um humano aprovou o manual.

    Devolve o estado final desta fase: PROVISORIA (sucesso, aguardando aprovacao
    humana sem prazo), REVERTIDA (aplicar/health falhou -> voltou ao backup na
    hora) ou FALHA.
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
    rel._ir(VERIFICANDO, ator, "verificacao de saude pos-aplicacao")
    rel.health_ok = bool(executor.verificar_saude())
    if not rel.health_ok:
        # PADRAO SEGURO: nao passou -> volta ao backup na hora (nao e' relogio)
        rel._ir(REVERTIDA, ator, "verificacao falhou -> voltou ao backup")
        rel.reverter_motivo = "health"
        executor.reverter(backup_ref)
        return rel.estado

    # entra em provisoria: aguarda aprovacao humana, SEM prazo
    rel.aguardando_desde = agora
    rel._ir(PROVISORIA, ator, "aplicada; aguardando aprovacao humana")
    return rel.estado


def confirmar(rel: Release, operador: str) -> str:
    """Humano aprovou -> consolida. So de PROVISORIA (transicao valida garante)."""
    rel._ir(CONSOLIDADA, operador, "aprovada pelo humano")
    rel.confirmada_por = operador
    rel.confirmada_em = _agora()
    return rel.estado


def reverter(rel: Release, executor: Executor, backup_ref: str,
             ator: str, motivo: str = "humano") -> str:
    """Reverte uma release provisoria para o backup. motivo: 'humano' (padrao)."""
    rel._ir(REVERTIDA, ator, f"revertida ({motivo})")
    rel.reverter_motivo = motivo
    rel.revertida_em = _agora()
    executor.reverter(backup_ref)
    return rel.estado
