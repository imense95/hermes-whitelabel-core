-- infra/db/init/04-skills-registry-prod.sql
-- Registro central de skills do produto (schema platform, banco 'plataforma').
--
-- Fonte de verdade do CONTEUDO da skill continua sendo o filesystem da imagem
-- (/opt/product/skills, aninhado: universal/<nome> e clientes/<slug>/...). Aqui
-- vive so o que o filesystem NAO sabe: escopo curado, dependencia de plugin,
-- pre-condicoes verificaveis, e — por (tenant, skill) — quem preparou/ativou,
-- a VERSAO DA BASE instalada e o OVERLAY travado do cliente.
--
-- Customizacao = overlay (delta) com versao TRAVADA: nao acompanha a base
-- automaticamente. Quando o cliente migra para uma base nova, a combinacao
-- anterior fica guardada em tenant_skill_versao para rollback.
--
-- Idempotente. Espelha o estilo de 03-admin-audit-prod.sql.

-- ------------------------------------------------------------------------
-- 1. Metadados curados por skill
--    O path ja sugere o escopo (universal/ vs clientes/.../especificas/), mas
--    plugin_dep e precondicoes nao vem do filesystem — sao nossos.
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.skill_meta (
    nome            text PRIMARY KEY,
    escopo          text NOT NULL CHECK (escopo IN ('universal','especifica')),
    requer_profile  boolean NOT NULL DEFAULT true,
    plugin_dep      text,                              -- skill que exige plugin (ex.: marketing)
    precondicoes    jsonb NOT NULL DEFAULT '[]'::jsonb,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform.skill_meta IS
  'Metadados curados por skill. O conteudo vive no filesystem da imagem; aqui so escopo, dependencia de plugin e pre-condicoes verificaveis.';

-- ------------------------------------------------------------------------
-- 2. Estado desejado por (tenant, skill) — a linha VIGENTE.
--    Nasce com a versao da base instalada e a referencia do overlay do cliente.
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.tenant_skill (
    tenant_slug     text NOT NULL REFERENCES platform.tenants(slug),
    skill_nome      text NOT NULL REFERENCES platform.skill_meta(nome),
    estado          text NOT NULL DEFAULT 'nao_instalada'
                    CHECK (estado IN ('nao_instalada','preparada','ativa','desativada')),
    profile         text,                    -- profile isolado onde foi preparada
    base_versao     text,                    -- versao da universal assada (SKILL.md version:) instalada no volume
    overlay_ref     text,                    -- clientes/<slug>/overlays/<nome>  (NULL = sem customizacao)
    overlay_versao  text,                    -- versao TRAVADA do overlay; independe da base
    preparada_por   text,
    preparada_em    timestamptz,
    ativada_por     text,
    ativada_em      timestamptz,
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_slug, skill_nome)
);

COMMENT ON COLUMN platform.tenant_skill.base_versao IS
  'Versao da base universal instalada no momento da preparacao. Congela o que esta no volume.';
COMMENT ON COLUMN platform.tenant_skill.overlay_ref IS
  'Overlay (delta) do cliente sobre a base. Versao travada em overlay_versao: nao acompanha a base ao migrar.';

-- ------------------------------------------------------------------------
-- 3. Historico versionado (append-only) — cada combinacao (base, overlay) ja
--    instalada. E' o indice sobre os backups em disco (.backup-<skill>-<ts>,
--    que o install da Admin API ja cria no volume). Quando a base migra, a
--    anterior fica aqui para rollback. Sem DELETE: a linhagem nao some.
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.tenant_skill_versao (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_slug     text NOT NULL,
    skill_nome      text NOT NULL,
    base_versao     text NOT NULL,
    overlay_ref     text,
    overlay_versao  text,
    profile         text,
    backup_ref      text,                    -- caminho do backup no volume (.backup-<skill>-<ts>), quando houver
    motivo          text NOT NULL DEFAULT 'preparacao'
                    CHECK (motivo IN ('preparacao','migracao-base','overlay-bump','rollback','desativacao')),
    instalada_por   text,
    instalada_em    timestamptz NOT NULL DEFAULT now(),
    substituida_em  timestamptz,             -- NULL = combinacao vigente; preenchido quando outra entra
    FOREIGN KEY (tenant_slug, skill_nome)
        REFERENCES platform.tenant_skill (tenant_slug, skill_nome)
);

CREATE INDEX IF NOT EXISTS tenant_skill_versao_lookup_idx
    ON platform.tenant_skill_versao (tenant_slug, skill_nome, instalada_em DESC);

-- No maximo UMA combinacao vigente por (tenant, skill). Garantido no banco,
-- nao na aplicacao: duas linhas com substituida_em IS NULL viram erro de chave.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_skill_versao_vigente_idx
    ON platform.tenant_skill_versao (tenant_slug, skill_nome)
    WHERE substituida_em IS NULL;

COMMENT ON TABLE platform.tenant_skill_versao IS
  'Historico imutavel de combinacoes (base, overlay) por tenant/skill. Guarda a anterior para rollback quando a base migra. Append-only (sem DELETE).';

-- ------------------------------------------------------------------------
-- 4. Amplia a trilha de auditoria para os verbos novos do painel.
--    A tabela ja existe em producao (03), entao CREATE TABLE IF NOT EXISTS nao
--    altera a constraint — precisa de ALTER explicito. Idempotente.
-- ------------------------------------------------------------------------
ALTER TABLE platform.admin_audit DROP CONSTRAINT IF EXISTS admin_audit_acao_check;
ALTER TABLE platform.admin_audit ADD CONSTRAINT admin_audit_acao_check
    CHECK (acao IN ('skills.list','skills.install','skills.prepare',
                    'skills.activate','skills.deactivate',
                    'plugins.list','plugins.install',
                    'logs.read','status','credentials.set','credentials.update'));

-- ------------------------------------------------------------------------
-- 5. Role do painel da assessoria (panel-api). Servico central, NOSSO, fora de
--    qualquer container de cliente — threat model diferente da role de cliente
--    (urban_app), que fica atras de SECURITY DEFINER. Esta role escreve o
--    estado desejado, mas NUNCA apaga o historico (rollback tem que sobreviver).
--    Nasce SEM senha: definida por humano fora do contexto do agente.
-- ------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_panel') THEN
    CREATE ROLE platform_panel LOGIN;
  END IF;
END
$$;

ALTER ROLE platform_panel NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT CONNECT ON DATABASE plataforma TO platform_panel;
GRANT USAGE  ON SCHEMA platform TO platform_panel;

-- catalogo curado + estado desejado: leitura e escrita
GRANT SELECT, INSERT, UPDATE ON platform.skill_meta   TO platform_panel;
GRANT SELECT, INSERT, UPDATE ON platform.tenant_skill TO platform_panel;

-- historico: pode inserir e marcar substituida; DELETE fica revogado abaixo.
-- (coluna de identidade nao exige USAGE em sequence: INSERT na tabela basta.)
GRANT SELECT, INSERT, UPDATE ON platform.tenant_skill_versao TO platform_panel;
REVOKE DELETE ON platform.tenant_skill_versao FROM platform_panel;

-- inventario de clientes e trilha: so leitura. Mutacao de tenant e' do
-- provisionamento; auditoria e' append via a funcao SECURITY DEFINER (03).
GRANT SELECT ON platform.tenants     TO platform_panel;
GRANT SELECT ON platform.admin_audit TO platform_panel;

-- nao cria objeto no schema nem enxerga schema de cliente nenhum.
REVOKE CREATE ON SCHEMA platform FROM platform_panel;

-- ------------------------------------------------------------------------
-- 6. Seed do catalogo curado (idempotente). O escopo vem do path na imagem
--    (universal/); plugin_dep e precondicoes vem da documentacao de ativacao.
-- ------------------------------------------------------------------------

-- marketing-conteudo: pre-condicoes conhecidas (docs/skill-marketing-ativacao.md).
-- Dois servicos de IA distintos (Gemini escreve, Nano Banana renderiza) + OAuth
-- do Drive. drive_conectado nao e' verificavel por API — fica como check manual.
INSERT INTO platform.skill_meta (nome, escopo, requer_profile, plugin_dep, precondicoes)
VALUES (
  'marketing-conteudo', 'universal', true, 'marketing',
  '[
    {"tipo":"credencial","chave":"GEMINI_API_KEY","como":"status.credenciais_configuradas"},
    {"tipo":"credencial","chave":"NANO_BANANA_API_KEY","nota":"ttapi.io: renderiza o PNG; env var do motor, nao modelo do gateway"},
    {"tipo":"credencial","chave":"MARKETING_GOOGLE_CLIENT_ID","como":"status.credenciais_configuradas"},
    {"tipo":"credencial","chave":"MARKETING_GOOGLE_CLIENT_SECRET","como":"status.credenciais_configuradas"},
    {"tipo":"plugin","nome":"marketing","como":"plugins.habilitados"},
    {"tipo":"externo","chave":"drive_conectado","verificacao":"manual"}
  ]'::jsonb
)
ON CONFLICT (nome) DO UPDATE
  SET escopo = EXCLUDED.escopo,
      requer_profile = EXCLUDED.requer_profile,
      plugin_dep = EXCLUDED.plugin_dep,
      precondicoes = EXCLUDED.precondicoes,
      atualizado_em = now();

-- triagem-descoberta-negocio: universal, assada na imagem da Urban. As
-- pre-condicoes exatas serao preenchidas ao ler o SKILL.md dela (PR seguinte);
-- por ora, vazio para nao inventar requisito. requer_profile=true pela regra
-- "toda skill universal nasce em profile proprio".
INSERT INTO platform.skill_meta (nome, escopo, requer_profile, plugin_dep, precondicoes)
VALUES ('triagem-descoberta-negocio', 'universal', true, NULL, '[]'::jsonb)
ON CONFLICT (nome) DO UPDATE
  SET escopo = EXCLUDED.escopo,
      requer_profile = EXCLUDED.requer_profile,
      atualizado_em = now();
