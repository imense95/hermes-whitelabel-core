# Provisionamento do Postgres da plataforma

Feito em 21/09/2026 pelo MCP do EasyPanel. Registra o que existe, como foi
verificado, e as armadilhas do caminho.

## O que existe

| item | valor |
|---|---|
| projeto EasyPanel | `hermes-whitelabel` |
| serviço Postgres | `plataforma-db` (postgres:16) |
| banco | `plataforma` |
| superusuário | `plataforma_admin` |
| host interno | `plataforma-db` (rede `easypanel-hermes-whitelabel`) |
| porta externa | **nenhuma** — `exposedPort: 0` |

Banco único para a plataforma inteira, schema + role por cliente. A Urban
recebeu o schema `urban` e a role `urban_app`.

## A role nasce sem senha, de propósito

`CREATE ROLE urban_app LOGIN` sem `PASSWORD`. O Postgres nega login enquanto
não houver senha, então o estado atual é seguro por omissão, não por
esquecimento.

Motivo: senha de banco não deve ser gerada no contexto de um LLM. Quem define
é humano, direto no painel:

```sql
ALTER ROLE urban_app WITH PASSWORD '<senha forte>';
```

Depois, a `DATABASE_URL` da instância (via Admin API, nunca no repo):

```
postgresql://urban_app:<senha>@plataforma-db:5432/plataforma?options=-csearch_path%3Durban
```

## O isolamento foi provado, não presumido

Oito asserções em PL/pgSQL, cada uma abortando a transação se o esperado não
acontecer (`infra/db/verificar-isolamento.sql`). As duas que importam usam
`SET LOCAL ROLE urban_app` e esperam `insufficient_privilege`:

- `SELECT` em `platform.tenants` → **permission denied** ✅
- `CREATE TABLE` em `public` → **permission denied** ✅
- `CREATE/INSERT/DROP` em `urban` → **funciona** ✅ (isolamento não é prisão)

Mais: schemas existem, `urban_app` é dono do próprio schema, sem
`SUPERUSER/CREATEDB/CREATEROLE`, sem senha, e a Urban está em
`platform.tenants`.

### Como o resultado foi lido sem ler log

`queryServiceLogs` responde `fetch failed` neste painel (Loki está ligado —
`getLogsSettings` confirma `enabled: true` — mas a consulta falha). Sem log,
o script virou um **sinal binário**:

```
assertivas passam → sleep 3600 → container "Up 3 minutes"
qualquer falha    → set -e → exit 1 → swarm reinicia → "Up 4 seconds" em loop
```

`getDockerContainers` mostrou `Up 3 minutes` estável. Como cada asserção
aborta em caso de falha e `set -e` derruba o container, uptime longo **é** a
prova de que as oito passaram.

Truque reaproveitável: quando não há canal de log, transforme o resultado em
tempo de vida do processo.

## Armadilhas encontradas

**`createComposeService` não funciona por API neste painel.** Criar e depois
`deployComposeService` falham iguais:

```
ENOENT: /etc/easypanel/projects/.../code/docker-compose.override.yml
```

O painel espera um arquivo que só a UI cria. Caminho que funciona:
`createAppService` com `source.type=image` e `mounts` de `type: file` — o
conteúdo vai como arquivo montado, e o EasyPanel materializa em
`/etc/easypanel/projects/<proj>/<svc>/files/N.txt`.

**Mount de arquivo evita o inferno de escape.** O SQL usa dollar-quoting
(`DO $$`), que colide com a interpolação `${VAR}` do compose. Passar SQL
inline exigiria escapar `$` → `$$` à mão. Como arquivo montado, nada é
interpretado.

**Serviços temporários foram destruídos.** `provisionar` e `verificar` já não
existem — sobrou só `plataforma-db`. Um serviço com a senha do banco no `env`
não deve ficar no painel depois de cumprir a função.

## Pendente

1. **Senha da `urban_app`** — passo humano, acima.
2. **`plataforma_admin`**: a senha foi gerada pelo EasyPanel e apareceu no
   retorno da API (portanto passou pelo contexto do agente). Rotacione antes
   de dados reais entrarem.
3. **`exposedPort: 0`** está certo — o banco só é alcançável pela rede
   interna. Não exponha para "facilitar" acesso externo; use um túnel
   pontual.
