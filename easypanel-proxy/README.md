# EasyPanel Proxy — acesso de leitura sem a chave admin

## Por que existe

O plano atual do EasyPanel **não permite usuário separado** (multi-usuário
exige Growth/Business). A única chave disponível é a de admin pleno.

Dar essa chave ao agente significaria duas coisas inaceitáveis:

1. **Poder de destruir produção.** `execute_destructive` em qualquer um dos 9
   projetos ativos — Chatwoot, Evolution API, as dashboards.
2. **Leitura de segredo em consulta de rotina.** Não é hipótese: em set/2026,
   um `getUser` — categoria *somente leitura* — devolveu em texto plano o
   `apiToken` da conta e o `twoFactorSecret` do 2FA. Um `listProjectsAndServices`
   trouxe as variáveis de ambiente de produção de vários projetos, com tokens
   dentro.

O proxy fica com a chave. O agente fala só com o proxy.

## As três camadas

Em ordem, cada chamada atravessa:

**1. Allowlist.** O que não está na lista não passa. Treze procedures, todas
conferidas na referência oficial da API:

| procedure | devolve |
|---|---|
| `listProjects` | nomes e datas dos projetos |
| `getUpdateStatus` | versão do painel |
| `getMetricsSettings` / `getLogsSettings` | configuração de métricas e de logs |
| `queryServiceLogs` | **logs de um serviço** (Loki) |
| `queryComposeServiceLogs` | logs de serviço Compose |
| `getAllServicesStats` | métricas atuais de todos os serviços |
| `getMetricsServiceStats` | métricas de um serviço no tempo |
| `getMetricsSystemStats` | métricas do host |
| `getLogsStats` | uso de disco do Loki/Promtail |
| `getDockerContainers` | containers de um serviço |
| `listPorts` / `listMounts` | portas e mounts de um serviço |

Allowlist e não denylist porque uma denylist erra por omissão: cada versão
nova do EasyPanel traz procedures que ninguém listou ainda.

**Fora da allowlist de propósito:** `inspectProject`, `inspectAppService` e
`inspectPostgresService`. São as mais úteis para diagnóstico e exatamente por
isso as piores — devolvem o `env` completo do serviço (`inspectPostgresService`
devolve credencial de banco). O scrub redigiria, mas uma procedure cuja razão
de ser é devolver configuração inteira não é procedure de diagnóstico
restrito. Se um caso real exigir um campo, o certo é um endpoint que projete
aquele campo. Três testes garantem que elas continuem barradas.

**2. Denylist explícita**, por cima da allowlist. Redundante de propósito —
se alguém ampliar a allowlist sem pensar, `getUser` e
`listProjectsAndServices` continuam barradas. Mais um regex que recusa
qualquer nome começando com `create|update|delete|restart|deploy|exec|set|…`.

**3. Scrub recursivo da resposta.** Mesmo em procedure permitida, todo campo
cujo *nome* cheire a segredo (`token`, `secret`, `env`, `password`, `dsn`, …)
vira `[REDIGIDO PELO PROXY]`. E todo *valor* que pareça segredo (PAT do
GitHub, chave `sk-`, JWT, DSN Postgres, hex de 48+ caracteres) também — é a
defesa contra o campo que ninguém previu.

## A URL: plano, não tRPC

Detalhe que custou uma rodada de 404: a API do EasyPanel é **plana**.

```
GET /api/<procedure>?param=valor        ✅
GET /api/trpc/<procedure>?input=<json>  ❌ 404 em tudo
```

O agrupamento que aparece na documentação (`projects/`, `logs/`, `metrics/`) é
só organização das páginas — **não entra na URL**. Um teste de regressão
(`test_url_montada_e_plana`) intercepta o cliente HTTP e confere a URL montada
e os parâmetros, para isso não voltar.

## A promessa central

**Escrita não é bloqueada: é inexistente.** Não há função `mutar()` neste
processo, nenhuma chamada `.post()/.put()/.patch()/.delete()`, e nenhuma rota
que aceite algo além de `GET`. Um agente comprometido não tem caminho de
código para emitir mutation ou destructive.

Dois testes verificam isso no **AST do próprio módulo**, não no texto — os
comentários falam de escrita justamente para explicar por que ela não existe.

## Uso

```sh
# gerar o token de acesso do agente
python app.py --gerar-token
# → PROXY_TOKEN=...          (para o agente)
# → PROXY_TOKEN_SHA256=...   (para o ambiente do serviço)
```

Ambiente do serviço:

```
EASYPANEL_URL=https://painel.seudominio
EASYPANEL_API_KEY=<chave admin — só aqui, em lugar nenhum mais>
PROXY_TOKEN_SHA256=<hash do token do agente>
```

Chamadas:

```sh
curl https://proxy.SEUDOMINIO/v1/projects \
  -H "Authorization: Bearer $PROXY_TOKEN" -H "X-Operador: herbert"

curl https://proxy.SEUDOMINIO/v1/allowlist \
  -H "Authorization: Bearer $PROXY_TOKEN" -H "X-Operador: herbert"
```

`/v1/allowlist` é autodescritiva: diz o que o proxy sabe fazer, o que barra, e
o que está pendente de confirmação. Consulte antes de tentar no escuro.

```sh
python -m pytest tests/ -q     # 48 testes, sem rede
```

## Logs: prontos, com uma dependência do painel

`/v1/service/logs` chama `queryServiceLogs`, que lê do **Loki**. Se a
agregação de logs estiver desligada no painel, a resposta vem vazia — isso
não é erro do proxy. `getLogsSettings` (exposto em `/v1/panel/status`) diz se
está ligada.

Log é texto livre, então é onde o scrub por **formato de valor** mais importa:
uma linha `DATABASE_URL=postgresql://…` não tem nome de chave para inspecionar.
Há teste para esse caso exato.

### Confirmar contra o seu painel

```sh
# no PowerShell, chamando o bash do Git (o "bash" solto cai no WSL)
& "C:\Program Files\Git\bin\bash.exe" ./confirmar-procedures.sh dashboard api
```

Mostra **só as chaves** de cada resposta, nunca os valores, e marca as que
trazem campo sensível. `404` significa que a sua versão do painel não tem
aquela rota — me avise para eu tirar da allowlist.

## Onde roda

Serviço separado da Admin API, imagem própria, usuário sem privilégio,
`/opt/proxy` sem escrita. Comprometer a Admin API de um cliente não entrega a
chave do painel, e vice-versa.

Uma instância do proxy para toda a plataforma (ele não é por cliente — a
chave do EasyPanel é uma só).
