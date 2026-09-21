-- infra/db/init/00-hardening.sql
-- Roda UMA vez, na criacao do cluster (docker-entrypoint-initdb.d).
-- Fecha o banco: ninguem cria nada solto no public, ninguem conecta sem GRANT.

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE app FROM PUBLIC;

-- schema tecnico da plataforma (controle, NAO dados de cliente).
-- Fica no mesmo banco por conveniencia operacional; nenhuma role de cliente
-- recebe USAGE aqui.
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.tenants (
    slug          text PRIMARY KEY,
    nome          text NOT NULL,
    schema_name   text NOT NULL UNIQUE,
    db_role       text NOT NULL UNIQUE,
    status        text NOT NULL DEFAULT 'provisionando'
                  CHECK (status IN ('provisionando','ativo','suspenso','encerrado')),
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform.tenants IS
  'Inventario de clientes. Fonte da verdade para migracoes e provisionamento.';
