# Arquitetura — plataforma white-label sobre Hermes

Documento de referência técnica. Versão 0.1 — piloto Urban.

## 1. Princípios que mandam no desenho

1. **Um container por cliente.** Nenhum processo Hermes é compartilhado entre
   clientes. Crash, upgrade, vazamento de prompt ou abuso de um cliente não
   alcança outro.
2. **Um Postgres, um schema por cliente.** Instância única compartilhada,
   `schema` dedicado por cliente, role dedicada por cliente. Nunca tabela
   multi-cliente com coluna `tenant_id` — o isolamento é do banco, não da
   aplicação.
3. **O container não tem credencial que não seja dele.** Cada um recebe só a
   DSN da própria role. Não existe senha de superuser dentro de container de
   cliente.
4. **Estado do agente ≠ dados do negócio.** Hermes guarda sessões, memória e
   skills em SQLite dentro do volume do cliente (`/opt/data/state.db`). O
   Postgres guarda os dados do produto (corridas, metas, relatórios,
   auditoria). Não tente mover o state.db para Postgres — não é suportado.

## 2. Topologia

```
                       internet
                          │
                    ┌─────▼─────┐   TLS, um subdomínio por cliente
                    │  Traefik  │   urban.SEUDOMINIO.com → hermes-urban:9119
                    └─────┬─────┘
             rede: edge   │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
 ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
 │ hermes-urban│   │ hermes-b    │   │ hermes-c    │   containers de cliente
 │ vol: urban  │   │ vol: b      │   │ vol: c      │   (sem link entre si)
 └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
        │  rede: db (internal: true)        │
        └─────────────────┼─────────────────┘
                   ┌──────▼──────┐
                   │  postgres   │  schemas: urban, b, c
                   └─────────────┘  roles:   urban_app, b_app, c_app
```

Três redes Docker:

| rede | `internal` | quem entra | por quê |
|---|---|---|---|
| `edge` | não | Traefik + cada container de cliente | entrada HTTP/TLS |
| `db` | **sim** | Postgres + cada container de cliente | Postgres nunca fica exposto ao host nem à internet |
| `egress-*` | opcional | container do cliente | allowlist de saída, se/quando for preciso |

Os containers de cliente compartilham a rede `db`, então em nível de IP um
alcança a porta do outro. O que impede o acesso cruzado é (a) não existir
credencial do vizinho e (b) o GRANT do Postgres. Se você quiser bloqueio em
camada de rede também, crie uma rede `db-<cliente>` por cliente e ligue o
Postgres em todas — custa uma linha por cliente no compose.

## 3. Isolamento no Postgres

Para cada cliente `X`, o provisionamento executa (idempotente):

```sql
CREATE ROLE x_app LOGIN PASSWORD '...';
CREATE SCHEMA x AUTHORIZATION x_app;

-- ninguém cria nada solto no public
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE app FROM PUBLIC;
GRANT CONNECT ON DATABASE app TO x_app;

-- a role só enxerga o próprio schema
ALTER ROLE x_app SET search_path = x;
```

Consequências que importam:

- `x_app` não recebe `USAGE` em schema nenhum além do seu → um `SELECT
  urban.corridas` a partir do container B falha com *permission denied*,
  mesmo que o atacante adivinhe o nome da tabela.
- `x_app` **não** é superuser e não é dono do banco → não consegue
  `CREATE SCHEMA`, não lê `pg_authid`.
- `search_path` travado na role significa que a aplicação escreve
  `SELECT * FROM corridas` sem prefixo, e a mesma migração roda igual em
  todos os schemas. Isso é o que torna o modelo schema-per-tenant barato de
  manter.

**Migrações:** um único conjunto de arquivos SQL versionados, aplicado em
loop sobre a lista de schemas, cada schema com sua própria tabela
`schema_migrations`. Um cliente pode ficar uma versão atrás sem travar os
outros — é uma vantagem real do modelo, use.

**Backup:** `pg_dump --schema=x` restaura um cliente sozinho. Faça o dump
por schema, não um dump global — restaurar um cliente a partir de um dump
global exige derrubar todo mundo.

## 4. A imagem white-label

Não faça fork do Hermes. Faça uma **imagem derivada**:

```dockerfile
FROM nousresearch/hermes-agent:<tag-fixada>
# branding, plugins do produto, tools do cliente, config base
COPY plugins/   /opt/hermes-product/plugins/
COPY skins/     /opt/hermes-product/skins/
```

Motivo: em imagem publicada o `/opt/hermes` é read-only para o usuário de
runtime — o core não é editável em execução, e todo estado mutável vive em
`/opt/data`. Customização entra por **plugin, skill, skin e config**, que é
exatamente o que sobrevive a um `docker pull` da próxima versão upstream.
Fork = você herda os merges do upstream para sempre.

O que o white-label cobre por esses pontos de extensão:
- **marca/tema** → skin (`display.skin`) + skin do dashboard
- **funcionalidade do cliente** → plugin com tools próprias (ex.: `urban_*`)
- **comportamento** → skills versionadas na imagem, não escritas à mão no volume
- **identidade** → `SOUL.md` por cliente, no volume

Fixe a tag do upstream. Nunca `:latest` em produção — upgrade é decisão sua,
por cliente.

## 5. Volume e segredos por cliente

```
/srv/hermes/<cliente>/          (bind mount → /opt/data no container)
├── .env          segredos: chave do provider LLM, DSN do Postgres, token da API do cliente
├── config.yaml   configuração (nunca segredo)
├── SOUL.md       identidade da instância
├── state.db      sessões (SQLite, WAL — ver nota abaixo)
├── skills/ memories/ sessions/ logs/ cron/
```

Regras:
- segredo só em `.env`; ajuste de comportamento só em `config.yaml`;
- `config.yaml` se edita com `hermes config set`, não na mão;
- **nunca** dois containers gateway apontando para o mesmo volume;
- o volume precisa ser filesystem nativo do host Linux (ext4/xfs). Bind
  mount atravessando VM (virtiofs no Docker Desktop, 9p no Windows) corrompe
  SQLite em WAL silenciosamente. Em produção Linux isso não acontece; no seu
  dev em Windows, use volume nomeado ou `database.journal_mode: delete`.

## 6. Dashboard e autenticação

O dashboard (porta 9119) é o que o cliente final vê. Bind não-loopback
**exige** provider de auth ou o processo falha ao subir — de propósito. Para
produto vendido, o caminho é OIDC self-hosted:
`HERMES_DASHBOARD_OIDC_ISSUER` + `HERMES_DASHBOARD_OIDC_CLIENT_ID`, com o
Traefik na frente e `dashboard.trusted_proxies` listando o IP exato do
proxy (nunca `0.0.0.0/0`). Basic auth serve para o piloto interno da Urban,
não para o produto.

Não exponha a porta 8642 (API server) para fora sem `API_SERVER_KEY` — e
mesmo assim, só se houver razão.

## 7. Integração com a API da Urban

A API da Urban expõe corridas e metas. O caminho recomendado:

```
API Urban ──HTTP──> plugin `urban` (tools no Hermes) ──> resposta ao usuário
     │
     └──ETL agendado (cron do Hermes)──> schema `urban` no Postgres
```

Dois papéis distintos, não confunda:
- **tools do plugin** = leitura ao vivo, o agente consulta quando o usuário
  pergunta. Sem cache, sem estado.
- **ETL + Postgres** = histórico, séries temporais, agregações que a API não
  dá barato, e tudo que precisa sobreviver a mudança/queda da API deles.

Comece pelas tools ao vivo (entrega valor na primeira semana) e só leve para
o Postgres o que doer: cálculo de meta acumulada, comparativo mês a mês,
relatório recorrente.

Token da API da Urban vive no `.env` do volume dela. Se a API tiver escopos,
peça o de leitura apenas para o piloto.

## 8. Provisionamento de um cliente novo

Um comando, idempotente (`infra/scripts/provision-tenant.sh <slug>`):

1. gera senha da role e cria role + schema no Postgres;
2. cria `/srv/hermes/<slug>/` com `.env` (DSN + chaves) e `config.yaml` base;
3. escreve o fragmento de serviço do compose e sobe o container;
4. registra a rota no Traefik por label;
5. roda as migrações no schema novo;
6. health check no `/health` antes de declarar pronto.

Enquanto forem menos de ~10 clientes, compose + esse script bastam. Acima
disso, o mesmo desenho sobe para Nomad/Kubernetes sem mudar o modelo de
dados — o que não escala é o script, não a arquitetura.

## 9. O que ficou decidido / o que ainda não

**Decidido:** container por cliente; Postgres único com schema+role por
cliente; imagem derivada em vez de fork; estado do agente em SQLite no
volume; Traefik com subdomínio por cliente; piloto = Urban.

**Em aberto (próximas decisões):**
- host de produção (VPS única? qual provedor? Linux, obrigatoriamente)
- provider de LLM e se a chave é sua (repassada no preço) ou do cliente
- OIDC: identity provider próprio ou Auth0/Keycloak
- quais tools da Urban entram na v1
- se o cliente pode editar skills ou se isso é só seu
```