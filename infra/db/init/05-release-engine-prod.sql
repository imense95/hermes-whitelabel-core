-- infra/db/init/05-release-engine-prod.sql
-- Release engine: aplicacao segura com janela de confirmacao (canary).
-- Schema central platform, banco 'plataforma'. Idempotente.
--
-- Uma release passa por: solicitada -> backup -> aplicando -> verificando ->
-- provisoria (relogio server-side) -> {consolidada | revertida}. O padrao
-- seguro e' REVERTER: sem confirmacao ate o deadline, um reconciliador
-- server-side reverte e avisa. O relogio e' o campo `deadline` aqui — NAO
-- depende do navegador do humano estar aberto.

-- ------------------------------------------------------------------------
-- Estados e tipos, como CHECK (nao enum: adicionar valor a enum exige lock;
-- CHECK versionado por migracao e' mais simples de evoluir).
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.release (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo          text NOT NULL CHECK (tipo IN ('migracao','imagem')),
    alvo          text NOT NULL,          -- schema (migracao) ou servico EasyPanel (imagem)
    descricao     text NOT NULL,          -- resumo legivel do que muda

    -- classificacao da taxonomia: 'auto' entra no canary; 'manual' exige
    -- aprovacao humana ANTES de aplicar (expand/contract p/ destrutivo).
    classe        text NOT NULL CHECK (classe IN ('auto','manual')),
    motivos       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- por que manual
    avisos        jsonb NOT NULL DEFAULT '[]'::jsonb,

    estado        text NOT NULL DEFAULT 'solicitada'
                  CHECK (estado IN ('solicitada','backup','aplicando','verificando',
                                    'provisoria','consolidada','revertida','falha')),

    -- referencias do que aplicar e como desfazer (a assimetria imagem/banco)
    payload_ref   text,        -- migracao: caminho do .sql; imagem: tag nova
    backup_ref    text,        -- migracao: caminho do pg_dump; imagem: tag anterior
    health_ok     boolean,     -- resultado do health check pos-aplicacao

    -- o relogio. deadline e' server-side; o reconciliador compara com now().
    janela_seg    integer NOT NULL,       -- 1800 p/ imagem; longo p/ migracao
    provisoria_em timestamptz,
    deadline      timestamptz,            -- provisoria_em + janela_seg

    -- quem/quando de cada transicao humana
    solicitada_por text NOT NULL,
    confirmada_por text,
    confirmada_em  timestamptz,
    revertida_em   timestamptz,
    reverter_motivo text,                 -- 'humano' | 'timeout' | 'health'

    criado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS release_estado_idx ON platform.release (estado, deadline);

-- No maximo UMA release provisoria por alvo: duas janelas correndo no mesmo
-- schema/servico e' ambiguo (qual backup vale?). Garantido no banco.
CREATE UNIQUE INDEX IF NOT EXISTS release_uma_provisoria_por_alvo_idx
    ON platform.release (tipo, alvo)
    WHERE estado IN ('backup','aplicando','verificando','provisoria');

COMMENT ON TABLE platform.release IS
  'Canary de aplicacao segura. Uma release fica provisoria com relogio server-side; sem confirmacao ate deadline, o reconciliador reverte. Padrao seguro = reverter.';

-- ------------------------------------------------------------------------
-- Trilha imutavel de cada transicao (append-only, para depurar auto-reverts).
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.release_evento (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    release_id  bigint NOT NULL REFERENCES platform.release(id),
    de_estado   text,
    para_estado text NOT NULL,
    ator        text NOT NULL,            -- operador, ou 'reconciliador' (auto)
    detalhe     text,
    ocorrido_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS release_evento_idx
    ON platform.release_evento (release_id, ocorrido_em);

-- ------------------------------------------------------------------------
-- A role platform_panel (criada no 04) opera o release engine: cria releases,
-- transiciona, le a trilha. NUNCA apaga (auditoria e historico sobrevivem).
-- ------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_panel') THEN
    GRANT SELECT, INSERT, UPDATE ON platform.release         TO platform_panel;
    GRANT SELECT, INSERT         ON platform.release_evento  TO platform_panel;
    REVOKE DELETE ON platform.release        FROM platform_panel;
    REVOKE DELETE ON platform.release_evento FROM platform_panel;
  END IF;
END
$$;
