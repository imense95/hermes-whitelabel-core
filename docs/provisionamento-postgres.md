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

## Senha da `urban_app`: aplicada sem passar por ninguém

Feito em 21/09/2026. A senha foi **gerada dentro do container**, com
`openssl rand`, aplicada por variável de sessão do `psql`
(`\set q :'senha'` → `ALTER ROLE ... PASSWORD :q`), e gravada apenas no
`.env` dentro do volume de dados da própria instância
(`hermes-whitelabel_urban_dados`, `chmod 600`, `chown 1000:1000`).

**O valor nunca foi ecoado.** O log do painel é legível pelo agente, então
imprimir a senha anularia o objetivo. Nem o agente nem este documento a
conhecem.

Três verificações antes de considerar pronto:

1. `rolpassword IS NOT NULL` → a senha existe
2. login real como `urban_app` → `current_user = urban_app`
3. `SHOW search_path` → `urban` (o travamento continua valendo)

Qualquer uma falhando aborta com `set -e` e o container reinicia em loop.
Observado `Up About a minute` estável.

### Trocar no primeiro acesso: não se aplica aqui

Essa senha **não é credencial de pessoa** — é da role de serviço que o
container usa para falar com o banco. O cliente nunca a digita e não tem onde
trocá-la; trocar exigiria reescrever o `.env` e reiniciar a instância.

A orientação de "trocar no primeiro login" pertence ao **acesso do cliente ao
dashboard** (Keycloak), que é outra credencial, de outro fluxo. Está no
onboarding, em `onboarding-e-acessos.md`.

Rotação da senha de banco é operação de manutenção: rodar o mesmo script de
novo gera outra senha, reescreve o `.env` e o próximo restart pega. Não é
tarefa do cliente.

## Pendente

1. **`plataforma_admin`** — rotacionar **pelo painel**, não por API. Ver
   abaixo.
2. **`exposedPort: 0`** está certo — o banco só é alcançável pela rede
   interna. Não exponha para "facilitar" acesso externo; use um túnel
   pontual.

### Armadilha: "role plataforma_admin does not exist" é mentira

Ao trocar a senha pela tela de Credentials, o painel devolve:

```
psql: error: ... /var/run/postgresql/.s.PGSQL:5432 failed
FATAL: database "plataforma_admin" does not exist
```

**A role existe e é superusuário.** Verificado direto em `pg_roles`:

```
plataforma_admin  super=true login=true
urban_app         super=false login=true
```

A mensagem fala do **banco**, não da role. O painel executa `psql -U <user>`
**sem `-d`**, e sem `-d` o `psql` usa como banco padrão o *nome do usuário*.
Existe o banco `plataforma`; não existia `plataforma_admin`. O `psql` tentou
abrir um banco homônimo do usuário, não achou, e abortou antes de rodar o
`ALTER ROLE`.

Isso acontece **sempre** que `user` ≠ `databaseName` na criação do serviço
Postgres do EasyPanel. Se ambos se chamassem `plataforma`, nunca apareceria.

**Correção aplicada:** criado o banco vazio `plataforma_admin`, dono
`plataforma_admin`, só para o default do `psql` cair em lugar válido.

Reproduzido e reprovado no mesmo container:

| | |
|---|---|
| antes | `FATAL: database "plataforma_admin" does not exist` |
| depois | `plataforma_admin\|plataforma_admin` |
| schemas | `urban,platform` — intactos |

O banco novo fica **vazio para sempre**: não tem schema de cliente, não tem
dado. É um alvo de aterrissagem para o default do `psql`. Custo em disco é
o de um template de catálogo.

**Para clientes futuros:** crie o serviço Postgres com `user` igual a
`databaseName`, e essa classe de erro não aparece.

### Por que a rotação do `plataforma_admin` não foi feita por API

`updatePostgresCredentials` exige a senha nova **no corpo da chamada**. Gerar
essa senha aqui a colocaria no contexto do agente — exatamente a exposição
que a rotação pretende corrigir. Trocaria uma senha vazada por outra vazada.

Reusar a senha da `urban_app` seria pior: daria ao portador do `.env` da
Urban as credenciais de **superusuário** do banco, colapsando o isolamento
que o schema por cliente existe para garantir.

Faça no painel: `hermes-whitelabel` → `plataforma-db` → Credentials → nova
senha. O EasyPanel redeploya o serviço sozinho. Nada mais depende dessa senha
(a instância da Urban usa `urban_app`).
