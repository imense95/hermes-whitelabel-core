# Instância da Urban no EasyPanel

Estado em 21/09/2026. Projeto `hermes-whitelabel`, serviço `urban`.

## O que está pronto

| item | estado |
|---|---|
| serviço `urban` | imagem `ghcr.io/imense95/hermes-whitelabel:staging`, command vazio (entrypoint oficial) |
| volume `dados` → `/opt/data` | `.env` completo, `600`, dono `10000:10000` |
| domínio dashboard | `https://hermes-whitelabel-urban.ajljmq.easypanel.host` → :9119 |
| domínio Admin API | `https://hermes-whitelabel-admin-urban.ajljmq.easypanel.host` → :8777 |
| env do painel | só config não-secreta (`HERMES_DASHBOARD=1`, `PUBLIC_URL`, portas) |
| `PGPASSWORD` | **removido** do env do serviço — a instância não precisa dele |

### Chaves em `/opt/data/.env` (nomes; valores nunca saíram do container)

```
DATABASE_URL                          role urban_app, search_path=urban
HERMES_DASHBOARD_BASIC_AUTH_USERNAME  urban
HERMES_DASHBOARD_BASIC_AUTH_PASSWORD  24 chars aleatórios
HERMES_DASHBOARD_BASIC_AUTH_SECRET    HMAC das sessões (sem ela, restart desloga)
ADMIN_API_TOKEN_SHA256                só o hash
ADMIN_AUDIT_DSN                       = DATABASE_URL (auditoria via função)
TENANT_SLUG                           urban
```

O token da Admin API em claro está em `/opt/data/ADMIN_API_TOKEN.leia-e-apague`
(`600`). Ler uma vez pelo painel (File Manager do volume), guardar no cofre da
assessoria, **apagar o arquivo**.

**Falta:** a chave do LLM. Entra no mesmo `.env`, pelo vault.

## Bloqueio atual

`deployAppService` → `401 unauthorized` em
`ghcr.io/v2/imense95/hermes-whitelabel/manifests/staging`. **O pacote está
privado.** Decisão tomada: deixar público. Ação humana em
`github.com/users/imense95/packages/container/hermes-whitelabel/settings`
→ Danger Zone → Change visibility → Public. O `gh` desta sessão não tem escopo
`packages` e não consegue fazer isso.

Depois: `deployAppService` de novo.

## Auditoria: o que quebrou e por quê

Três rodadas até a prova passar. Cada falha ensinou algo que agora está no SQL.

1. **`permission denied for schema platform`** — `GRANT EXECUTE` na função não
   basta; sem `USAGE` no schema o Postgres nem resolve o nome. `USAGE` sem
   `SELECT` não lê tabela nenhuma, então é seguro dar. A verificação prova as
   duas coisas.

2. **`role plataforma_admin nao e role de cliente`** — dentro de `SECURITY
   DEFINER`, `current_user` vira o **dono** da função. O que identifica quem
   logou é `session_user`, que nem `SET ROLE` altera. Trocado.

3. **Verificação por `SET ROLE` não vale** — um bloco `DO` do superusuário com
   `SET LOCAL ROLE urban_app` não reproduz o caminho real. O teste agora
   conecta **com a DSN da própria instância** (`psql "$DATABASE_URL"`), que é
   o que a Admin API faz em produção.

Prova final (logado como `urban_app`): registra via função ✅ · não lê
`admin_audit` ✅ · não lê `tenants` ✅ · não cria tabela em `platform` ✅.

## Por que não há wrapper de start

O `ENTRYPOINT` oficial é `/opt/hermes/docker/entrypoint-dispatch.sh`, que sobe
o s6 como root, acerta o dono do volume, e dropa para `hermes` (UID 10000) em
**cada** serviço supervisionado — gateway, dashboard e a nossa Admin API. Um
`exec hermes gateway run` como root pularia o s6, e a Admin API não subiria.
`HERMES_HOME=/opt/data` é ENV da imagem; o Hermes lê `/opt/data/.env` sozinho.
Command vazio é o correto.

## Armadilhas do EasyPanel por API (custaram tempo hoje)

- **`updateMount` acrescenta em vez de substituir** quando o índice não bate
  → `duplicate mount point` no deploy. Sempre `inspectAppService` antes para
  ver a ordem real; ela **não** é a ordem de criação.
- `deleteMount` por índice: apagar de **trás para frente** para os índices
  não deslizarem.
- `createDomain` exige `"id": ""` presente (validação falha sem a chave).
- `updateMount` é `execute_destructive`, `createMount` é `execute_mutation`.
- `getDockerContainers` → `[]` = o container **nem nasceu** (imagem
  inacessível, mount inválido). Não é "ainda subindo".
