-- Verificacao do isolamento. Cada bloco FALHA a transacao se o resultado
-- esperado nao acontecer, entao "rodou sem erro" = "isolamento provado".
\set ON_ERROR_STOP on

-- 1. schemas existem
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('platform','urban')) <> 2
    THEN RAISE EXCEPTION 'FALHA: schemas platform/urban nao existem'; END IF;
END $$;

-- 2. urban e' dono do proprio schema
DO $$
BEGIN
  IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='urban') <> 'urban_app'
    THEN RAISE EXCEPTION 'FALHA: urban_app nao e dono do schema urban'; END IF;
END $$;

-- 3. role sem privilegio elevado
DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolcreatedb, rolcreaterole INTO r FROM pg_roles WHERE rolname='urban_app';
  IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
    THEN RAISE EXCEPTION 'FALHA: urban_app tem privilegio elevado'; END IF;
END $$;

-- 4. role NAO tem senha ainda (senha e' passo humano)
DO $$
BEGIN
  IF (SELECT rolpassword IS NOT NULL FROM pg_authid WHERE rolname='urban_app')
    THEN RAISE EXCEPTION 'FALHA: urban_app ja tem senha — nao deveria'; END IF;
END $$;

-- 5. O TESTE QUE IMPORTA: urban_app NAO le o registro de clientes.
DO $$
BEGIN
  SET LOCAL ROLE urban_app;
  PERFORM 1 FROM platform.tenants LIMIT 1;
  RESET ROLE;
  RAISE EXCEPTION 'FALHA GRAVE: urban_app conseguiu ler platform.tenants';
EXCEPTION
  WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'OK: urban_app recebeu permission denied em platform.tenants';
END $$;

-- 6. urban_app NAO cria objeto no schema public compartilhado
DO $$
BEGIN
  SET LOCAL ROLE urban_app;
  EXECUTE 'CREATE TABLE public.invasao_teste(x int)';
  RESET ROLE;
  EXECUTE 'DROP TABLE IF EXISTS public.invasao_teste';
  RAISE EXCEPTION 'FALHA GRAVE: urban_app criou tabela no schema public';
EXCEPTION
  WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'OK: urban_app recebeu permission denied no schema public';
END $$;

-- 7. urban_app CONSEGUE trabalhar no proprio schema (isolamento nao e' prisao)
DO $$
BEGIN
  SET LOCAL ROLE urban_app;
  EXECUTE 'CREATE TABLE IF NOT EXISTS urban.teste_escrita(x int)';
  EXECUTE 'INSERT INTO urban.teste_escrita VALUES (1)';
  EXECUTE 'DROP TABLE urban.teste_escrita';
  RESET ROLE;
  RAISE NOTICE 'OK: urban_app escreve no proprio schema';
END $$;

-- 8. registro do cliente presente
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.tenants WHERE slug='urban' AND db_role='urban_app')
    THEN RAISE EXCEPTION 'FALHA: urban ausente de platform.tenants'; END IF;
END $$;
