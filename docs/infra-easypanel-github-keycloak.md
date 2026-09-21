# Infraestrutura: EasyPanel, GitHub e Keycloak

Decisões fechadas em set/2026 e o que elas implicam. Complementa
`arquitetura.md` (topologia) e `onboarding-e-acessos.md` (fluxo e acessos).

## As três decisões

| decisão | escolha | consequência principal |
|---|---|---|
| Host | EasyPanel | provisionamento via MCP nativo; não há mais `docker compose up` manual |
| Identity provider | Keycloak self-hosted | um realm por cliente; sem custo por usuário |
| Chave do LLM | do cliente | a assessoria grava a chave dele via Admin API na entrega |

A terceira decisão é a que mais muda o produto: se a chave é do cliente, a
instância **não funciona** até alguém gravá-la. Era por isso que faltava o
quinto verbo da Admin API — sem ele, a entrega "plugada e funcionando"
dependia de o cliente editar um `.env`, que é exatamente o que ele comprou
para não fazer.

---

## EasyPanel

### Conexão MCP

O EasyPanel embute um servidor MCP remoto (Streamable HTTP). A chave sai de
**Configurações → Servidor → Usuários → Gerar API Key**, e depois
**Conectar → MCP** mostra a URL completa.

Ele expõe **quatro ferramentas**, separadas por risco — e é essa separação
que torna possível o modo leitura por padrão:

| ferramenta | o que faz |
|---|---|
| `search_procedures` | descobre operações e seus schemas |
| `execute_query` | operação somente leitura |
| `execute_mutation` | mudança não destrutiva |
| `execute_destructive` | apaga, sobrescreve, restaura, revoga |

### Dois usuários, não um

O modo "leitura por padrão, escrita só ao provisionar" **não é uma opção de
configuração do MCP** — o servidor age com as permissões do usuário cujo API
key ele carrega, e não há um botão de somente-leitura. Portanto a separação
tem que ser feita por usuário:

- **`hermes-diagnostico`** — API key no `config.yaml`, conectada o tempo todo.
  Usuário com acesso de leitura aos projetos. É o que o agente local usa para
  investigar, ver logs, conferir estado.
- **`hermes-provisionamento`** — API key **fora** do config, guardada no cofre
  da equipe. Só entra no ambiente durante um onboarding, e sai depois.

Configuração do primeiro (`~/.hermes/config.yaml` da SUA máquina, não do
cliente):

```yaml
mcp_servers:
  easypanel:
    url: "https://SEU-PAINEL/api/mcp"
    headers:
      Authorization: "Bearer ${EASYPANEL_DIAG_KEY}"
    timeout: 120
```

O segundo só aparece quando você for provisionar, e some depois. Rotacione a
chave de provisionamento a cada onboarding — ela é a chave do reino.

Regra que vale a pena manter mesmo com a separação de usuários: **nunca
aprovar `execute_destructive` sem ler o projeto e o serviço alvo**. Um
`destructive` no serviço errado apaga o container de um cliente pagante.

### Serviços no painel

| serviço | tipo | origem |
|---|---|---|
| `postgres` | Postgres (template) | — |
| `keycloak` | App | imagem oficial |
| `hermes-<slug>` | App | GitHub → build → deploy |

Um projeto EasyPanel por cliente isola o que aparece no painel e permite
limitar o usuário MCP por projeto. O Postgres e o Keycloak ficam num projeto
`plataforma` à parte.

A rede interna do EasyPanel já liga os serviços; o Postgres **não** ganha
domínio público. Continua valendo: nada de porta 5432 exposta.

---

## GitHub como fonte da verdade

### Três repositórios, não um

```
hermes-whitelabel-core      (privado)  imagem, admin-api, infra, docs
hermes-whitelabel-catalog   (privado)  catálogo de skills do produto
cliente-<slug>              (privado)  config e skills próprias do cliente
```

**Por que separar core e catálogo:** o catálogo muda toda semana (skill nova,
ajuste de prompt); o core muda raramente e cada mudança exige rebuild de
imagem. Juntos, todo ajuste de texto de skill dispara um rebuild de imagem
para todos os clientes.

**Por que um repo por cliente:** o `config.yaml`, o `SOUL.md` e as skills
específicas dele são versionados e revisáveis, e o histórico de um cliente
não vaza para outro. Segredo nenhum entra aqui — credenciais vão pela Admin
API, nunca pelo git.

### Deploy automático

EasyPanel faz deploy a partir do GitHub por webhook. O fluxo:

```
push na main do core  →  webhook EasyPanel  →  build da imagem  →  deploy
```

Ponto importante: **o deploy automático não deve atingir todos os clientes de
uma vez**. Um bug que sobe para 20 instâncias simultâneas é um incidente com
20 clientes. O caminho:

1. push no core faz build e deploy **só no ambiente de staging**;
2. promoção para cada cliente é uma ação explícita (tag de versão por
   cliente no EasyPanel);
3. a Urban, sendo piloto, pode acompanhar a main — é o que a torna útil como
   piloto.

Isso é a mesma regra da tag fixada do upstream, um nível acima: você decide
quando cada cliente sobe de versão.

---

## Keycloak

Um realm por cliente. Não um realm compartilhado com grupos — realm separado
significa que um erro de configuração no cliente A não tem como dar acesso ao
cliente B.

Por cliente:

- realm `<slug>`
- client `hermes-dashboard`, **público com PKCE (S256)** — o Hermes não
  suporta client confidencial (com `client_secret`)
- redirect URI: `https://<slug>.SEUDOMINIO/auth/callback`

No `.env` da instância:

```
HERMES_DASHBOARD_OIDC_ISSUER=https://auth.SEUDOMINIO/realms/<slug>
HERMES_DASHBOARD_OIDC_CLIENT_ID=hermes-dashboard
```

O Hermes verifica o **ID token** (RS256/ES256) contra o `jwks_uri`, com `iss`
e `aud` presos ao que você configurou. Os endpoints precisam ser HTTPS.

O Keycloak precisa do próprio Postgres persistente — **não** suba em modo dev
(`start-dev` usa banco em memória e perde tudo no restart). No mesmo Postgres
da plataforma, com schema `keycloak` próprio, seguindo o mesmo padrão dos
clientes.

---

## Admin API: por que dentro da instância

A versão anterior deste desenho era um script no host via SSH. Com EasyPanel
isso deixou de fazer sentido: não há host seu para manter, e SSH ao host do
EasyPanel dá acesso a **todos** os containers — o oposto de acesso restrito.

A API vive dentro do container do cliente, num processo próprio supervisionado
pelo s6, na porta 8777, exposta num domínio próprio
(`admin-<slug>.SEUDOMINIO`). Cinco verbos:

| verbo | rota |
|---|---|
| listar skills | `GET /v1/skills` |
| instalar skill | `POST /v1/skills/install` |
| ver logs | `GET /v1/logs` |
| ver status | `GET /v1/status` |
| gravar credenciais | `POST /v1/credentials` |

### O que a mudança de local NÃO mudou

Continua valendo tudo que definia o plano B: a API **não fala com o agente**,
**não lê `sessions/` nem `memories/`**, e não executa comando arbitrário. Ela
mudou de lugar, não de escopo.

### Decisões de segurança embutidas

- **Token com hash no ambiente.** O container guarda `ADMIN_API_TOKEN_SHA256`,
  nunca o token. Vazar o `.env` de um cliente não dá acesso à API dele.
- **`X-Operador` obrigatório.** O token autoriza, o header diz quem foi.
  Auditoria sem nome é log, não auditoria.
- **Mutação sem trilha é recusada.** `skills.install` e `credentials.set`
  auditam **antes** de escrever; se o Postgres da auditoria estiver
  inalcançável, a operação não acontece. Um install sem trilha é pior que um
  install que não aconteceu. Leitura degrada para arquivo e segue.
- **Credenciais são write-only.** A API grava no `.env`, nunca lê de volta.
  Quem comprometer o token ganha a capacidade de sobrescrever credenciais —
  não a de exfiltrar as que já estavam lá. `GET /v1/status` responde presença
  (`true`/`false`), nunca valor.
- **Allowlist de chaves, não denylist.** Só as chaves de credencial conhecidas
  podem ser gravadas. Uma denylist erra por omissão, e o erro aqui é gravar
  `LD_PRELOAD` ou `DATABASE_URL` e virar execução de código no próximo boot.
- **Quebra de linha no valor é rejeitada** — num `.env`, `\n` injeta outra
  variável.
- **Skill vem do catálogo da imagem, nunca de upload.** Aceitar conteúdo de
  skill por HTTP é execução de código arbitrário no agente do cliente com
  outro nome.
- **Sem Swagger público** (`/docs` e `/openapi.json` desligados). A superfície
  é documentada aqui, não servida pela própria API.

31 testes cobrem essas promessas, incluindo os caminhos de recusa. Rodam sem
Docker e sem Postgres: `cd admin-api && python -m pytest tests/ -q`.

### Entrega de uma instância pronta

É isto que o quinto verbo resolve — o cliente não configura nada:

```sh
curl -X POST https://admin-urban.SEUDOMINIO/v1/credentials \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Operador: herbert@assessoria" \
  -H "Content-Type: application/json" \
  -d '{"credenciais": {"OPENROUTER_API_KEY": "sk-or-...",
                       "TELEGRAM_BOT_TOKEN": "123:abc",
                       "TELEGRAM_ALLOWED_USERS": "5511..."}}'
```

Depois, reinicie a instância pelo EasyPanel para o gateway reler o `.env`, e
confirme com `GET /v1/status` que `pronta_para_uso` é `true`.
