"""
Classificador de migracao — a taxonomia (auto vs manual) virada CODIGO.

A regra escrita do projeto: uma mudanca so e' AUTO-ELEGIVEL (pode entrar no
canary com auto-revert) se reverter for lossless. Destrutivo — que perde dado
committado na janela — e' SEMPRE MANUAL e vai por expand/contract, nunca por
auto-revert.

Aqui isso deixa de ser convencao de conversa e vira um gate mecanico: lemos o
AST do SQL com o parser NATIVO do Postgres (pglast/libpg_query) e classificamos
cada statement. Um unico statement destrutivo torna a migracao inteira MANUAL.

O classificador NAO julga se a migracao esta correta — so se ela e' segura de
auto-reverter. Statements que nao da' para inspecionar (bloco DO com plpgsql
arbitrario) nao bloqueiam: viram AVISO para olho humano, porque as migracoes
sao revisadas em PR e versionadas. O gate duro e' so o destrutivo explicito.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pglast
from pglast.enums import AlterTableType, ConstrType


@dataclass
class Classificacao:
    classe: str                       # "auto" | "manual"
    motivos: list[str] = field(default_factory=list)   # por que e' manual
    avisos: list[str] = field(default_factory=list)    # para olho humano
    statements: int = 0

    @property
    def auto(self) -> bool:
        return self.classe == "auto"


def _nome(node) -> str:
    return type(node).__name__


def _analisa_alter_table(stmt) -> tuple[list[str], list[str]]:
    """Devolve (motivos_manual, avisos) para um ALTER TABLE.

    ADD COLUMN nullable, ADD CONSTRAINT CHECK/FK, DROP CONSTRAINT sao aditivos/
    reversiveis. DROP COLUMN, ALTER TYPE, SET NOT NULL, ADD UNIQUE/PRIMARY sobre
    dado existente podem perder dado ou falhar no revert — manual.
    """
    motivos: list[str] = []
    avisos: list[str] = []
    for cmd in (stmt.cmds or []):
        sub = cmd.subtype
        if sub == AlterTableType.AT_DropColumn:
            motivos.append("ALTER TABLE DROP COLUMN (perde dado da coluna)")
        elif sub == AlterTableType.AT_AlterColumnType:
            motivos.append("ALTER TABLE ALTER COLUMN TYPE (pode perder precisao)")
        elif sub == AlterTableType.AT_SetNotNull:
            motivos.append("ALTER TABLE SET NOT NULL (backfill; falha se ha NULL)")
        elif sub == AlterTableType.AT_AddColumn:
            col = cmd.def_
            constrs = getattr(col, "constraints", None) or []
            tem_notnull = any(c.contype == ConstrType.CONSTR_NOTNULL for c in constrs)
            tem_default = any(c.contype == ConstrType.CONSTR_DEFAULT for c in constrs)
            if tem_notnull and not tem_default:
                motivos.append("ALTER TABLE ADD COLUMN NOT NULL sem default (backfill)")
        elif sub == AlterTableType.AT_AddConstraint:
            con = cmd.def_
            ct = getattr(con, "contype", None)
            if ct in (ConstrType.CONSTR_UNIQUE, ConstrType.CONSTR_PRIMARY):
                motivos.append("ALTER TABLE ADD UNIQUE/PRIMARY sobre dado existente")
            # CHECK e FOREIGN: aditivos, revert = DROP CONSTRAINT. Mas um CHECK
            # que estreita valores pode falhar no revert se algo novo foi
            # gravado na janela — aviso, nao bloqueio.
            elif ct == ConstrType.CONSTR_CHECK:
                avisos.append("ADD CONSTRAINT CHECK: revert falha se valor novo "
                              "gravado na janela violar o CHECK antigo")
        # AT_DropConstraint: so remove uma regra, nao perde dado -> auto
    return motivos, avisos


# Statements aditivos/reversiveis por natureza -> auto.
_AUTO = {
    "CreateStmt",         # CREATE TABLE
    "CreateSchemaStmt",   # CREATE SCHEMA
    "IndexStmt",          # CREATE INDEX
    "CreateFunctionStmt",
    "ViewStmt",
    "CreateSeqStmt",
    "CreateTrigStmt",
    "GrantStmt", "GrantRoleStmt",     # GRANT/REVOKE
    "CreateRoleStmt", "AlterRoleStmt",
    "CommentStmt",
    "InsertStmt",         # seed
    "VariableSetStmt",    # SET
}

# Statements destrutivos -> manual, com o motivo exato.
_MANUAL = {
    "DropStmt": "DROP explicito (TABLE/COLUMN/etc)",
    "TruncateStmt": "TRUNCATE (apaga todas as linhas)",
    "DeleteStmt": "DELETE (remove linhas existentes)",
    "UpdateStmt": "UPDATE (migracao de dados em linhas existentes)",
    "RenameStmt": "RENAME (quebra referencia; revert nao e' trivial)",
    "AlterObjectSchemaStmt": "mudanca de schema de objeto (move dados)",
}


def classificar_migracao(sql: str) -> Classificacao:
    """Classifica um script de migracao inteiro.

    auto  = todos os statements sao aditivos/reversiveis.
    manual = pelo menos um statement e' destrutivo (ou muda dado existente).
    Levanta ValueError se o SQL nao parseia (deixa o chamador tratar).
    """
    try:
        arvore = pglast.parse_sql(sql)
    except pglast.parser.ParseError as e:
        raise ValueError(f"SQL nao parseia: {e}") from e

    motivos: list[str] = []
    avisos: list[str] = []
    n = 0
    for raw in arvore:
        stmt = raw.stmt
        n += 1
        nome = _nome(stmt)
        if nome == "AlterTableStmt":
            m, a = _analisa_alter_table(stmt)
            motivos.extend(m)
            avisos.extend(a)
        elif nome in _MANUAL:
            motivos.append(_MANUAL[nome])
        elif nome == "DoStmt":
            # plpgsql arbitrario: nao da' para inspecionar. No projeto e' usado
            # para CREATE ROLE idempotente. Nao bloqueia; avisa.
            avisos.append("bloco DO nao inspecionavel (plpgsql) — confira a mao")
        elif nome in _AUTO:
            pass
        else:
            # desconhecido: conservador, mas so avisa (migracao e' revisada em PR)
            avisos.append(f"statement nao classificado: {nome}")

    classe = "manual" if motivos else "auto"
    return Classificacao(classe=classe, motivos=motivos, avisos=avisos, statements=n)
