# Onboarding de cliente e os dois planos de acesso

Documento de desenho. Complementa `arquitetura.md`. Versão 0.1.

Escopo desta etapa: fazer a Urban existir como cliente completo da plataforma.
Integração com a API da Urban e skills de negócio ficam para a etapa 2.

---

## Parte 1 — Fluxo de onboarding

O onboarding é **um comando idempotente** (`scripts/onboard-client.sh`), não
uma sequência manual. Sequência manual vira cliente meio provisionado quando
alguém erra um passo, e cliente meio provisionado é o pior estado possível:
o container sobe, o schema não existe, e o erro só aparece no primeiro uso.

### Os seis passos

| # | passo | falha significa |
|---|---|---|
| 1 | registra em `platform.tenants` | nome/slug duplicado — aborta antes de criar qualquer coisa |
| 2 | cria role + schema no Postgres | trata-se do isolamento; sem isso nada mais acontece |
| 3 | cria `/srv/hermes/<slug>/` com `.env` (DSN gerada) e `config.yaml` base | volume do cliente |
| 4 | gera `clients/<slug>.yml` a partir do template | rota e limites |
| 5 | sobe o container e espera o health check | se não ficar saudável, o passo 6 não roda |
| 6 | aplica as migrações no schema novo | tabelas do produto |

Idempotência de verdade: rodar duas vezes não regenera senha, não duplica
registro, não derruba container saudável. Isso importa porque o comando vai
ser rodado de novo — para consertar um passo que falhou, para aplicar uma
migração nova, ou porque alguém não lembrou se já tinha rodado.

### Estados de um cliente

`platform.tenants.status` governa o ciclo de vida:

- `provisionando` — passos 1-4 feitos, container ainda não saudável
- `ativo` — operando
- `suspenso` — container parado (inadimplência, pedido do cliente). Schema e
  volume **intactos**. Reversível com um comando.
- `encerrado` — container removido, dump do schema arquivado, volume retido
  pelo período de retenção acordado, e só então apagado.

Suspender ≠ encerrar. Não apague dados de cliente em nenhum passo automático:
`encerrado` marca para apagar, a exclusão é uma ação separada e deliberada.

### Rollback

Se o passo 5 ou 6 falha, o comando **não** desfaz os passos 1-4. Deixa o
tenant em `provisionando` e imprime o que falhou. Desfazer automaticamente um
provisionamento parcial é como se perdem dados; deixar visível e consertável é
melhor. Existe `scripts/deprovision-client.sh` para remoção explícita.

---

## Parte 2 — Os dois planos de acesso

### O fato que decide o desenho

**O Hermes não tem níveis de permissão dentro de uma instância.** O portão de
autenticação do dashboard é binário: você entrou ou não entrou. Quem entra
conversa com o agente, e conversar com o agente é ter todas as tools dele —
terminal, arquivos, rede. Não existe "usuário só-leitura" nem "usuário que só
instala skill" dentro do Hermes.

Consequência direta, e é o ponto mais importante deste documento:

> O acesso restrito da assessoria **não pode** ser uma conta no dashboard do
> cliente. Se for, é acesso total disfarçado.

A restrição precisa vir de fora do container, de uma ferramenta que só sabe
fazer as operações permitidas.

### Plano A — acesso do cliente (uso normal)

- **Superfície:** dashboard do Hermes em `https://<slug>.SEUDOMINIO.com`,
  mais os canais de mensageria que ele usar (Telegram/WhatsApp).
- **Autenticação:** OIDC self-hosted (`HERMES_DASHBOARD_OIDC_*`), cliente
  público com PKCE, callback em `https://<slug>.SEUDOMINIO/auth/callback`.
- **Poder:** total sobre o próprio agente. É o produto dele.
- **Escopo:** um realm/grupo por cliente no IdP. O usuário da Urban não
  existe como identidade válida em nenhuma outra instância.
- **Mensageria:** allowlist obrigatória por instância
  (`TELEGRAM_ALLOWED_USERS`, etc.). Sem allowlist o gateway nega todo mundo —
  o default é fechado, e é para continuar assim. **Nunca**
  `GATEWAY_ALLOW_ALL_USERS=true` em instância de cliente.

### Plano B — acesso técnico da assessoria (suporte e manutenção)

> **Atualizado (set/2026).** Este plano era um script SSH no host. Com a
> decisão pelo EasyPanel isso deixou de fazer sentido: não há host seu para
> manter, e SSH ao host do EasyPanel dá acesso a *todos* os containers — o
> oposto de acesso restrito. Virou uma **API dentro da própria instância**.
> Detalhes de implementação em `infra-easypanel-github-keycloak.md`; o escopo
> abaixo não mudou.

Não é conta, não é login no agente do cliente. É uma **API separada dentro do
container do cliente** (porta 8777, domínio próprio) com cinco verbos:

| verbo | rota | onde toca |
|---|---|---|
| listar skills | `GET /v1/skills` | lê `/opt/data/skills/` |
| instalar skill | `POST /v1/skills/install` | copia do catálogo da imagem |
| ler logs | `GET /v1/logs` | lê `/opt/data/logs/` |
| ver status | `GET /v1/status` | volume + presença de credenciais |
| gravar credenciais | `POST /v1/credentials` | escreve `/opt/data/.env` |

O quinto verbo existe porque a chave do LLM é do cliente: sem ele, a entrega
"plugada e funcionando" dependeria de o cliente editar um `.env` — que é
exatamente o que ele comprou para não fazer. Ele é **write-only**: grava,
nunca lê de volta.

O que a ferramenta **deliberadamente não tem**: conversar com o agente, ler
`sessions/`, ler `memories/`, ler o `.env` do cliente, executar comando
arbitrário no container, `docker exec` livre. Não é limitação técnica — é a
definição do plano. Se um dia precisar de mais, adiciona-se um verbo novo,
revisado, e não uma porta dos fundos.

**Por que não ler as sessões:** `sessions/` é a conversa do cliente com o
agente dele. É o material mais sensível do volume. Suporte técnico não precisa
disso para instalar uma skill ou ler um stack trace; se um caso específico
exigir, que seja com pedido do cliente e registro.

**Autenticação do plano B:** bearer token por instância (o container guarda
só o SHA-256; vazar o `.env` não dá acesso à API) **mais** o header
`X-Operador` obrigatório. O token autoriza, o header diz quem foi — sem
usuário compartilhado, porque auditoria só funciona se disser *quem*.

**Auditoria:** todo verbo grava em `platform.admin_audit` (quem, qual cliente,
qual ação, quando, resultado), com role própria que tem INSERT nessa tabela e
mais nada — sem UPDATE e sem DELETE, porque auditoria que o próprio auditado
apaga não é auditoria. Os dois verbos que mudam estado (`skills.install`,
`credentials.set`) auditam **antes** de escrever: se o Postgres da auditoria
estiver inalcançável, a operação é recusada. Um install sem trilha é pior que
um install que não aconteceu. Leituras degradam para arquivo local e seguem.
O cliente pode pedir esse extrato — e poder mostrá-lo é o que torna o acesso
defensável.

### O que separa os dois planos, concretamente

| | Plano A (cliente) | Plano B (assessoria) |
|---|---|---|
| entra por | `<slug>.dominio`, OIDC/Keycloak | `admin-<slug>.dominio`, bearer + X-Operador |
| fala com o agente | sim | **não** |
| lê sessões/memória | sim (é dele) | **não** |
| instala skill | depende (ver decisão em aberto) | sim, do catálogo |
| lê logs | via dashboard | sim, via ferramenta |
| credencial do banco | nunca vê | nunca vê |
| auditado em | logs do Hermes | `platform.admin_audit` |

Os dois planos nunca se cruzam: a assessoria não tem conta no IdP do cliente,
e o cliente não tem acesso ao host.

---

## Decisões — situação em set/2026

**Fechadas:**

1. ~~Host~~ → **EasyPanel**, com MCP nativo para provisionamento. Dois
   usuários: `hermes-diagnostico` (leitura, sempre conectado) e
   `hermes-provisionamento` (escrita, só durante onboarding). Ver
   `infra-easypanel-github-keycloak.md`.
2. ~~Identity provider~~ → **Keycloak self-hosted**, um realm por cliente,
   client público com PKCE.
3. ~~Chave do LLM~~ → **do cliente**. Foi o que criou o quinto verbo da Admin
   API: sem ele a instância não funciona até alguém configurar a chave.
4. ~~Fonte da verdade do código~~ → **GitHub**, três repos, deploy automático
   só em staging; promoção por cliente é explícita. Ver `repositorios.md`.

**Fechadas na mesma rodada:**

5. ~~Cliente instala skills próprias?~~ → **Não.** Toda skill é instalada pela
   assessoria, via `POST /v1/skills/install`, sempre a partir do catálogo
   assado na imagem. A estrutura atual (`skills/<nome>`) está correta — não
   há necessidade de separar `skills/_produto/`, porque não existe skill de
   outra origem para colidir.
6. ~~Domínio~~ → **subdomínio do domínio do produto**, `<slug>.SEUDOMINIO`,
   e `admin-<slug>.SEUDOMINIO` para a Admin API. Domínio personalizado do
   cliente entra só quando for pedido; o EasyPanel aceita adicionar um
   domínio a mais no mesmo serviço, então isso não exige mudança de desenho.
7. ~~Cofre de tokens~~ → **variável de ambiente segura do GitHub/EasyPanel**,
   sem cofre externo por ora. O `onboard-client.sh` grava em
   `~/.hermes-whitelabel/cofre/<slug>/` e você move de lá para o campo de
   secret do painel.

   Consequência a não esquecer: um secret de painel **não tem histórico nem
   rotação automática**. Se o token da Admin API de um cliente precisar ser
   trocado, é ação manual em dois lugares (o `ADMIN_API_TOKEN_SHA256` no
   serviço e o token em si no seu secret). Aceitável no piloto; revisite
   quando passar de uns 5 clientes.

**Ainda em aberto:**


8. **Retenção no encerramento.** Quantos dias o volume e o dump do schema
   sobrevivem a um `encerrado`. Entra em contrato antes da primeira venda —
   **não bloqueia o piloto técnico.**
