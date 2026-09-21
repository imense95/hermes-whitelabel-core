# Plataforma white-label sobre Hermes

Fork-free: o core do Hermes vem da imagem upstream, a marca e as
funcionalidades entram por plugin/skill/skin/config. Um container por cliente,
um Postgres compartilhado com schema e role isolados por cliente. Hospedado no
EasyPanel, identidade no Keycloak, código no GitHub.

Este README é o operacional. O porquê está em `docs/`:

| documento | assunto |
|---|---|
| `docs/arquitetura.md` | topologia, isolamento no Postgres, por que não fazer fork |
| `docs/onboarding-e-acessos.md` | fluxo de cadastro, plano A (cliente) e plano B (assessoria) |
| `docs/infra-easypanel-github-keycloak.md` | as três decisões de infra e o que implicam |
| `docs/repositorios.md` | os três repos e a política de deploy |
| `easypanel-proxy/README.md` | por que a chave admin não fica com o agente |

```
admin-api/           Admin API do plano B + 31 testes
easypanel-proxy/     proxy de leitura do EasyPanel + 48 testes
image/               Dockerfile derivado e serviço s6
infra/               compose de referência, SQL de init, migrações
scripts/             onboard-client.sh (onboarding fim a fim)
.github/workflows/   build da imagem (não faz deploy em cliente)
```

## EasyPanel Proxy

O plano do EasyPanel não permite usuário separado, então a única chave é a de
admin pleno. O proxy fica com ela e expõe ao agente cinco procedures de
leitura, com scrub de segredo na saída. Escrita não é bloqueada — é
inexistente: não há `.post()` no código nem rota não-`GET`.

Detalhes e o passo pendente (confirmar as procedures de log) em
`easypanel-proxy/README.md`.

## Onboarding de um cliente

Um comando, idempotente. Faz os seis passos: registra o tenant, cria role e
schema no Postgres, cria realm e client no Keycloak, sobe o serviço no
EasyPanel, espera ficar saudável, aplica as migrações.

```sh
export BASE_DOMAIN=seudominio.com.br GITHUB_ORG=suaorg
export EASYPANEL_API_KEY=...      # usuário hermes-provisionamento
export PG_SUPERUSER_PASSWORD=... KEYCLOAK_ADMIN_PASSWORD=... ADMIN_AUDIT_PASS=...

./scripts/onboard-client.sh urban "Urban"

unset EASYPANEL_API_KEY           # a chave de escrita sai do ambiente
```

A instância sobe autenticada mas **muda** — a chave do LLM é do cliente e
ainda não existe. A entrega se completa gravando-a:

```sh
curl -X POST https://admin-urban.$BASE_DOMAIN/v1/credentials \
  -H "Authorization: Bearer $(cat ~/.hermes-whitelabel/cofre/urban/admin-api.token)" \
  -H "X-Operador: seu.nome@assessoria" \
  -H "Content-Type: application/json" \
  -d '{"credenciais": {"OPENROUTER_API_KEY": "sk-or-..."}}'
```

Reinicie pelo EasyPanel e confira `GET /v1/status` → `pronta_para_uso: true`.

## Admin API (plano B)

Acesso técnico da assessoria. Roda dentro do container do cliente, porta 8777,
domínio próprio. Cinco verbos e nada além:

| verbo | rota |
|---|---|
| listar skills | `GET /v1/skills` |
| instalar skill do catálogo | `POST /v1/skills/install` |
| ler logs | `GET /v1/logs?arquivo=gateway.log&linhas=200` |
| ver status | `GET /v1/status` |
| gravar credenciais | `POST /v1/credentials` |

Toda chamada exige `Authorization: Bearer` **e** `X-Operador: <nome>`.

```sh
cd admin-api       && python -m pytest tests/ -q   # 31 testes, sem Docker
cd easypanel-proxy && python -m pytest tests/ -q   # 48 testes, sem rede
```

## Regras que não se negociam

- A Admin API **não** fala com o agente, **não** lê `sessions/` nem
  `memories/`, e credenciais são write-only. Não é limitação técnica: é a
  definição do plano B.
- Mutação sem trilha de auditoria é recusada. `ADMIN_AUDIT_MODE=file` é só
  para dev.
- Skill instalada vem do catálogo assado na imagem, nunca de upload.
- Tag do upstream sempre fixada; `:latest` não entra em produção.
- Push na `main` faz deploy só em staging. Promoção para cliente é explícita,
  uma de cada vez.
- Segredo nenhum no git. Credenciais chegam pela Admin API.
- Nunca dois gateways no mesmo volume de dados.
- Keycloak: realm por cliente, client **público com PKCE** (o Hermes não
  suporta client confidencial), e Postgres persistente — `start-dev` perde
  tudo no restart.
- `pg_dump --schema=<slug>` para backup, nunca dump global.

## Estado atual

**Verificado:** 79 testes passam (31 Admin API + 48 proxy); `bash -n` limpo em
todos os scripts; `docker compose config` válido; o workflow do GitHub Actions
é YAML válido.

**Não verificado** (sem daemon Docker nesta máquina): build da imagem,
execução real do `onboard-client.sh`, e o teste de isolamento cruzado entre
schemas — um container tentando ler o schema de outro cliente deve levar
*permission denied*. Esse teste prova a promessa central do produto; rodar
assim que houver ambiente.

**Etapa atual:** Urban como cliente completo. Integração com a API da Urban e
skills de negócio são a etapa 2.
