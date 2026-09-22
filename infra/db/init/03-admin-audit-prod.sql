-- infra/db/init/03-admin-audit-prod.sql
-- Auditoria da Admin API, versao para o banco 'plataforma' (producao).
-- O 01-admin-audit.sql referencia DATABASE app (dev local) e nao foi
-- aplicado em producao. Este arquivo e' a fonte de verdade para producao.
-- Idempotente.

CREATE TABLE IF NOT EXISTS platform.admin_audit (
    id          bigserial PRIMARY KEY,
    ocorrido_em timestamptz NOT NULL DEFAULT now(),
    operador    text NOT NULL,
    tenant_slug text NOT NULL REFERENCES platform.tenants(slug),
    acao        text NOT NULL
                CHECK (acao IN ('skills.list','skills.install','logs.read','status',
                                'credentials.set','credentials.update')),
    detalhe     text,
    resultado   text NOT NULL CHECK (resultado IN ('ok','erro')),
    erro        text
);

CREATE INDEX IF NOT EXISTS admin_audit_tenant_idx
    ON platform.admin_audit (tenant_slug, ocorrido_em DESC);

-- A Admin API roda DENTRO do container do cliente e conecta como a role do
-- cliente (urban_app). Dar a essa role INSERT direto em platform.admin_audit
-- exigiria USAGE no schema platform — e USAGE e' a porta que o isolamento
-- fecha. Em vez disso: uma FUNCAO com SECURITY DEFINER, dona = superusuario,
-- que so sabe inserir. A role do cliente executa a funcao, nunca toca a
-- tabela. O tenant_slug vem de current_user, NAO de parametro: um cliente
-- nao consegue registrar acao em nome de outro.
CREATE OR REPLACE FUNCTION platform.registrar_admin_audit(
    p_operador  text,
    p_acao      text,
    p_detalhe   text,
    p_resultado text,
    p_erro      text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
DECLARE
    v_slug text;
    v_id   bigint;
BEGIN
    -- role do cliente e' <slug>_app; deriva o slug de QUEM LOGOU.
    -- session_user, NAO current_user: dentro de SECURITY DEFINER o
    -- current_user vira o dono da funcao (plataforma_admin). Provado em
    -- producao: com current_user a funcao recusava a propria urban_app.
    -- session_user e' imutavel na sessao — nem SET ROLE muda.
    v_slug := regexp_replace(session_user, '_app$', '');
    IF v_slug = session_user THEN
        RAISE EXCEPTION 'role % nao e'' role de cliente', session_user
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM platform.tenants WHERE slug = v_slug) THEN
        RAISE EXCEPTION 'tenant % nao cadastrado', v_slug
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO platform.admin_audit (operador, tenant_slug, acao, detalhe, resultado, erro)
    VALUES (p_operador, v_slug, p_acao, p_detalhe, p_resultado, p_erro)
    RETURNING id INTO v_id;
    RETURN v_id;
END
$$;

-- Ninguem executa por padrao; so as roles de cliente, explicitamente.
REVOKE ALL ON FUNCTION platform.registrar_admin_audit(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.registrar_admin_audit(text,text,text,text,text) TO urban_app;

-- USAGE no schema e' necessario para RESOLVER O NOME da funcao — sem ele,
-- EXECUTE nao adianta ('permission denied for schema platform', provado na
-- verificacao). USAGE sozinho nao da leitura de tabela nenhuma: a leitura
-- exige SELECT, que continua revogado. A verificacao (verificar-auditoria.sql)
-- prova as duas coisas: registra via funcao E falha ao ler tenants/audit.
GRANT USAGE ON SCHEMA platform TO urban_app;
REVOKE CREATE ON SCHEMA platform FROM urban_app;
REVOKE ALL ON ALL TABLES    IN SCHEMA platform FROM urban_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA platform FROM urban_app;
