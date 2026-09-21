-- infra/db/init/01-admin-audit.sql
-- Auditoria do plano B (acesso tecnico da assessoria).
-- Toda acao da ferramenta admin grava aqui. O cliente pode pedir o extrato.

CREATE TABLE IF NOT EXISTS platform.admin_audit (
    id          bigserial PRIMARY KEY,
    ocorrido_em timestamptz NOT NULL DEFAULT now(),
    operador    text NOT NULL,          -- usuario SSH; nunca conta compartilhada
    tenant_slug text NOT NULL REFERENCES platform.tenants(slug),
    acao        text NOT NULL
                CHECK (acao IN ('skills.list','skills.install','logs.read','status')),
    detalhe     text,                   -- qual skill, quantas linhas, etc.
    resultado   text NOT NULL CHECK (resultado IN ('ok','erro')),
    erro        text
);

CREATE INDEX IF NOT EXISTS admin_audit_tenant_idx
    ON platform.admin_audit (tenant_slug, ocorrido_em DESC);

-- Role da ferramenta admin: INSERT na auditoria e SELECT no inventario.
-- Nao e' superuser e nao enxerga schema de cliente nenhum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_admin_tool') THEN
    CREATE ROLE platform_admin_tool LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE app TO platform_admin_tool;
GRANT USAGE  ON SCHEMA platform TO platform_admin_tool;
GRANT SELECT ON platform.tenants TO platform_admin_tool;
GRANT INSERT ON platform.admin_audit TO platform_admin_tool;
GRANT USAGE  ON SEQUENCE platform.admin_audit_id_seq TO platform_admin_tool;

-- Sem UPDATE e sem DELETE de proposito: auditoria que o proprio auditado
-- pode apagar nao e' auditoria.
REVOKE UPDATE, DELETE ON platform.admin_audit FROM platform_admin_tool;

-- status de ciclo de vida do tenant (ver docs/onboarding-e-acessos.md)
ALTER TABLE platform.tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE platform.tenants ADD CONSTRAINT tenants_status_check
    CHECK (status IN ('provisionando','ativo','suspenso','encerrado'));
