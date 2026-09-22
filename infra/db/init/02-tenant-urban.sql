
-- Provisionamento inicial da plataforma white-label.
-- Idempotente: rodar de novo nao quebra nem apaga nada.

-- Registro central de clientes. Fora do schema de qualquer cliente.
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.tenants (
  slug          text PRIMARY KEY,
  nome          text NOT NULL,
  schema_name   text NOT NULL,
  db_role       text NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- --- cliente: urban -------------------------------------------------------
-- A role nasce SEM senha de proposito: senha definida por humano, fora do
-- contexto do agente. Postgres nega login enquanto nao houver senha.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'urban_app') THEN
    CREATE ROLE urban_app LOGIN;
  END IF;
END
$$;

ALTER ROLE urban_app SET search_path = urban;
ALTER ROLE urban_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

CREATE SCHEMA IF NOT EXISTS urban AUTHORIZATION urban_app;
GRANT CONNECT ON DATABASE plataforma TO urban_app;

-- O isolamento e' isto: negar tudo que nao e' o proprio schema.
-- Em platform, o cliente fica com USAGE (resolver nomes) e NADA mais: a
-- unica coisa que ele alcanca la e' a funcao de auditoria, cujo GRANT fica
-- em 03-admin-audit-prod.sql. Sem SELECT, USAGE nao le tabela nenhuma.
REVOKE ALL ON SCHEMA public   FROM urban_app;
REVOKE ALL ON SCHEMA platform FROM urban_app;
GRANT  USAGE ON SCHEMA platform TO urban_app;
REVOKE ALL ON ALL TABLES    IN SCHEMA platform FROM urban_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA platform FROM urban_app;

-- Impede que um cliente futuro crie objeto no schema public compartilhado.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

INSERT INTO platform.tenants (slug, nome, schema_name, db_role)
VALUES ('urban', 'Urban Passageiro', 'urban', 'urban_app')
ON CONFLICT (slug) DO UPDATE
  SET nome = EXCLUDED.nome, atualizado_em = now();
