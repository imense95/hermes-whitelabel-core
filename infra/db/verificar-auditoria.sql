-- infra/db/verificar-auditoria.sql
-- Verificacao da auditoria via funcao. Roda LOGADO COMO a role do cliente
-- (psql "$DATABASE_URL" -f este-arquivo), NAO via SET ROLE de superusuario:
-- dentro de SECURITY DEFINER o current_user vira o dono, e SET ROLE num
-- bloco DO nao reproduz o caminho real. Falha = transacao abortada.
DO $$
DECLARE v_id bigint;
BEGIN
  IF current_user NOT LIKE '%\_app' THEN
    RAISE EXCEPTION 'FALHA: rode logado como <slug>_app, nao %', current_user;
  END IF;
  -- 1. consegue registrar
  v_id := platform.registrar_admin_audit('teste','status','verificacao','ok',NULL);
  IF v_id IS NULL THEN RAISE EXCEPTION 'FALHA: registrar devolveu NULL'; END IF;
  -- 2. NAO le a auditoria
  BEGIN
    PERFORM count(*) FROM platform.admin_audit;
    RAISE EXCEPTION 'FALHA: cliente leu platform.admin_audit';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- 3. NAO le tenants
  BEGIN
    PERFORM count(*) FROM platform.tenants;
    RAISE EXCEPTION 'FALHA: cliente leu platform.tenants';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- 4. NAO cria nada em platform (USAGE sem CREATE)
  BEGIN
    EXECUTE 'CREATE TABLE platform.x_invasao(i int)';
    RAISE EXCEPTION 'FALHA: cliente criou tabela em platform';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
-- Limpeza do registro de teste: como superusuario, fora deste arquivo.
