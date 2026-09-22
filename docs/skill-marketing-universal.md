# Skill universal de marketing — desenho v1

Origem: projeto `Marketing Autonomo` (Node, ~9,2k linhas, funcional para a Urban).
Objetivo: virar item do catálogo da plataforma, rodando por cliente com identidade
própria, saída no Google Drive do cliente, config no schema do cliente.

Decisões tomadas com o Herbert em 22/09/2026:
- Motor Node embarcado na imagem derivada (Node 20 + ffmpeg); a skill chama `node cli.js`.
- v1 = gerar posts (artes + legendas) e salvar no Drive; aprovação pelo chat do
  dashboard. Telegram/Instagram/WhatsApp/vídeo ficam para v2.
- OAuth Google: app OAuth único da plataforma; cada cliente autoriza a própria conta.
- Config da marca e token OAuth: Postgres, schema do cliente.
- Onboarding do zero com a Urban como cobaia (ignorar brand-kit/calendário prontos).

## 1. Peças no catálogo

Duas peças, como o Hermes separa capacidade (tools) de procedimento (skill):

```
catalog/
  plugins/marketing/            # plugin Python: 4 tools → node cli.js
    plugin.yaml
    __init__.py
    ferramentas.py              # reaproveitado de hermes-plugin/marketing-urban
    motor/                      # o projeto Node, copiado (agent/, scripts/, package.json)
  skills/marketing-conteudo/    # a skill: instruções + scripts
    SKILL.md                    # procedimento: onboarding, revisar config, gerar, revisar
    references/onboarding.md    # roteiro do passo a passo, pergunta a pergunta
    references/brand-schema.md  # o contrato brand_config, campo a campo, com exemplos
    scripts/validar-brand.py    # valida a config antes de gravar (cores hex, fontes, logo)
```

Tools do plugin (v1):

| tool | ações | gasta crédito? |
|---|---|---|
| `marketing_config` | `status`, `iniciar_onboarding`, `responder`, `revisar`, `atualizar`, `exportar` | não |
| `marketing_drive` | `status`, `conectar`, `concluir_conexao`, `desconectar`, `pastas` | não |
| `marketing_calendario` | `status`, `listar`, `hoje`, `entrada`, `adicionar`, `editar` | não |
| `marketing_post` | `referencias`, `gerar` (confirmar=true), `estado`, `aprovar`, `descartar` | `gerar` sim |

Regra herdada e mantida: tudo que gasta crédito devolve `confirmacao_necessaria`
na 1ª chamada; a 2ª vem com `confirmar=true` depois de o usuário ver o resumo.

## 2. Persistência (schema do cliente)

```sql
-- tudo dentro do schema do cliente (search_path já aponta para lá)
create table marketing_brand_config (
  id            smallint primary key default 1 check (id = 1),   -- singleton
  versao        int not null default 1,
  config        jsonb not null,            -- o brand-kit universal (ver §3)
  onboarding    jsonb not null default '{}', -- progresso: etapa atual, respostas parciais
  atualizado_em timestamptz not null default now()
);
create table marketing_brand_config_hist (  -- revisar/atualizar guarda versão anterior
  versao int, config jsonb, motivo text, atualizado_em timestamptz default now()
);
create table marketing_credenciais (
  provedor      text primary key,          -- 'google_drive'
  refresh_token text not null,             -- cifrado em repouso (ver §5)
  conta         text,                      -- e-mail autorizado (para exibir)
  escopos       text[],
  pastas        jsonb,                     -- {raiz, referencias, saida} = ids no Drive
  criado_em     timestamptz default now()
);
create table marketing_calendario (
  data date primary key, titulo text, headline text, subheadline text,
  cta text, publico text, formato text, color_direction text,
  arte_textos text[], status text default 'pendente', drive_ids jsonb
);
create table marketing_historico_referencias (  -- rodízio (cooldown) do reference-selector
  data date primary key, referencia_drive_id text, referencia_nome text
);
create table marketing_geracoes (             -- log técnico: o que foi gerado, custo, erro
  id bigserial primary key, data date, iniciado_em timestamptz, concluido_em timestamptz,
  variacoes int, imagens_ok int, erro text, drive_pasta_id text
);
```

Logo e referências visuais **não** ficam no banco: ficam no Drive do cliente
(pasta `Identidade/` e `Referências/`). O banco guarda só os ids.

## 3. Contrato `brand_config` (universal)

Generalização direta do `brand-kit.json`. Mudanças em relação ao original:

- `fleet` → `subject_rules` genérico: `{ deve_aparecer[], nunca_aparecer[], notas }`.
  Para a Urban vira "carro popular brasileiro; nunca luxo/SUV". Para uma padaria,
  "pão artesanal, forno; nunca embalagem industrial".
- `colors.scheme_rule` explícito: `"alternar_pb_com_detalhe"` (o padrão Urban:
  base preto/branco alternando, uma cor de detalhe ≤15% por peça) **ou**
  `"paleta_livre"`. O prompt-builder lê a regra em vez de ter a Urban em texto.
- `typography.heading.family` obrigatório + `allowed_fonts`/`forbidden_fonts`.
- `logo`: ids no Drive (`primary`, `icon`, `white_version`, `black_version`) +
  `treatments` (livre / com badge) + `contrast_rule` (sempre invertido).
- `formats[]`: por rede, `{ rede, nome, ratio, w, h, ativo }`. Onboarding pergunta
  quais redes; default = feed 1:1 + stories 9:16.
- `company`, `visual_style`, `tone_of_voice`: iguais ao original.

Campo a campo em `references/brand-schema.md`.

## 4. Onboarding (a skill conduz, no chat)

Máquina de estados guardada em `marketing_brand_config.onboarding` — pode parar e
retomar dias depois sem perder o que já foi respondido. Etapas:

1. **Empresa** — nome, segmento, cidade/região, site, instagram, whatsapp, slogan.
2. **Drive** — `marketing_drive conectar` (§5). Só segue com o Drive ligado: a logo
   e as referências vão para lá, não para o volume.
3. **Logo** — pede os arquivos (o cliente envia no chat); skill sobe para
   `Identidade/` no Drive, guarda ids. Mínimo: 1 versão. Pergunta qual é clara/escura.
4. **Cores** — primária, detalhe, fundos claro/escuro; valida hex; pergunta a
   regra de esquema (P&B + detalhe, ou paleta livre).
5. **Tipografia** — família de título (obrigatória), corpo, fallback; proibidas.
6. **Estilo visual** — 5 adjetivos, o que evitar, marcas de inspiração.
7. **Tom de voz** — personalidade, frases de assinatura, palavras proibidas, CTA, públicos.
8. **Sujeito** — o que deve/nunca aparecer nas imagens (`subject_rules`).
9. **Referências** — pede 5 a 20 imagens de posts que o cliente gosta (dele ou de
   outros). Sobe para `Referências/`. Roda `analisar-referencia` (Vision) em cada
   uma e guarda a análise no banco — é o que o `reference-selector` já usa.
10. **Formatos por rede** — quais redes; confirma os tamanhos.
11. **Revisão final** — mostra um resumo legível; `validar-brand.py`; grava
    `config` versão 1; **gera 1 arte de teste** (com confirmação de crédito) para
    o cliente ver a identidade aplicada antes de qualquer calendário.

Cada etapa termina com critério checável ("hex válido e contraste ≥ 4.5 entre texto
e fundo", "logo ≥ 512px", "≥ 5 referências analisadas").

**Revisar/atualizar depois:** `marketing_config revisar` mostra a config por
seção; `atualizar secao=cores campo=accent valor=#...` grava versão nova e guarda a
anterior em `_hist`. Trocar logo/referência = enviar arquivo novo; a skill sobe,
troca o id, mantém o antigo em `Identidade/_anteriores/`.

## 5. Google Drive — OAuth sem callback público

Restrição real: o container roda no servidor, o navegador do cliente roda na
máquina dele. `redirect_uri=http://localhost` (o que o gws local usa) **não
funciona** aqui. Duas saídas:

**(A) Device flow — proposta para v1.** Google "OAuth for TV and Limited-Input
Devices": a skill mostra no chat uma URL (`google.com/device`) e um código de 8
letras; o cliente abre no celular/PC, loga na conta dele, digita o código, autoriza.
A skill faz polling e recebe o refresh token. Zero rota pública, zero secret
exposto ao navegador. O escopo `drive.file` está na lista suportada pelo device
flow. Encaixa exatamente no pedido "clica, abre navegador, autoriza, sem colar chave".

**(B) Callback na Admin API** (`/v1/marketing/google/callback`, rota pública com
`state` assinado). Mais "botão que abre o navegador", mas abre rota sem bearer num
serviço que hoje é fechado. Fica para v2 se o device flow incomodar na UX.

**Escopo: `drive.file` (não `drive`).** `drive` é escopo *restrito* — exige
verificação de segurança do Google (CASA) para app em produção; sem isso o app fica
em "teste", limitado a 100 usuários e tokens que expiram em 7 dias. `drive.file`
não é restrito, mas só enxerga arquivos que o **próprio app criou**. Consequência de
desenho: **a skill cria a estrutura de pastas e sobe ela mesma logo e referências**
(o cliente manda no chat, a skill grava no Drive). Se o cliente soltar arquivo
direto na pasta pelo Drive, a skill não vê. Isso é aceitável para v1 e evita a
verificação do Google; documentar para o cliente.

Estrutura criada no Drive do cliente:
```
<Nome do cliente> — Marketing/
  Identidade/            logos, fontes
  Referências/           imagens de inspiração (+ _analises.json espelho)
  Saída/AAAA-MM-DD/      v1_1_1.png, v1_9_16.png, legendas.md, briefing.json
```

Token em repouso: `refresh_token` cifrado com chave derivada do `API_SERVER_KEY`
da instância (já existe no `.env`, único por cliente). Não é HSM, mas o banco já
é isolado por role e o segredo de cifra nunca sai do container do cliente.

Pré-requisito da plataforma (uma vez, humano): criar o OAuth client tipo
"TVs and Limited Input devices" no Google Cloud da plataforma; `client_id` e
`client_secret` entram como env da imagem/instância (`GOOGLE_OAUTH_CLIENT_ID/SECRET`),
nunca pelo chat.

## 6. Mudanças no motor Node (cirurgia mínima)

1. `prompt-builder.js`: apagar `URBAN_BRAND`; criar `brandConstraints(brandData)`
   que gera o mesmo bloco a partir de `colors`, `typography`, `subject_rules`,
   `company.location`. Mesma saída para a Urban → regressão zero.
2. `design-system.js`: `BRAND_LOGO_SPEC` vira função `logoSpec(colors, logo)`.
3. `brand-assets.js`: recebe os PNGs por caminho (baixados do Drive para
   `$TMPDIR`), não de `./brand/logo`.
4. Novo `agent/storage/drive.js`: `ensureFolders`, `upload`, `download`, `list`.
   `outputs/` local vira cache temporário; o registro de verdade é o Drive + banco.
5. Novo `agent/config/store.js`: lê/grava `brand_config`, calendário e histórico via
   `DATABASE_URL` (pg). Substitui `lerJSON(caminho(...))` em `tools.js`.
6. `cli.js`: ações novas (`config.*`, `drive.*`); remover Telegram/Instagram/WhatsApp
   da superfície v1 (o código fica, não é exposto).

Chaves de API do motor (`GEMINI_API_KEY`, `NANO_BANANA_API_KEY`) são **do
cliente**, como a chave do LLM: entram na allowlist da Admin API / tela.

## 7. Imagem derivada

`image/Dockerfile`: instalar Node 20 + ffmpeg; `COPY catalog/plugins/marketing/motor
/opt/marketing`; `npm ci --omit=dev` no build (sharp precisa de build nativo —
usar a imagem base com glibc, não alpine). Baileys/puppeteer saem do
`package.json` da v1 (não expostos, pesam ~200MB).

## 8. Ordem de execução

1. Schema SQL + `store.js` + testes (sem rede).
2. Universalizar `prompt-builder`/`design-system` com teste de regressão: a saída
   para o brand-kit da Urban tem que ser idêntica à de hoje.
3. `drive.js` + device flow + testes com mock HTTP.
4. Plugin `marketing` (4 tools) + `cli.js` novo.
5. `SKILL.md` + `references/onboarding.md` + `brand-schema.md` + `validar-brand.py`.
6. Dockerfile + build `:staging` + deploy na Urban.
7. **Onboarding real do zero na Urban**, etapa a etapa, com o Herbert.

## Riscos declarados

- `drive.file` não vê arquivo solto na pasta pelo cliente — só o que a skill subiu.
- App OAuth da plataforma em modo "teste" até publicar: usuários precisam estar na
  lista de test users; publicar (sem escopo restrito) é um formulário, não auditoria.
- Nano Banana via TTAPI é intermediário de terceiro; a chave é do cliente, o risco de
  disponibilidade é dele — dizer isso no onboarding.
- Imagem cresce ~300MB (Node + sharp + ffmpeg). Aceito.
