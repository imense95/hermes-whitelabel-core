# Repositórios no GitHub

Três repos privados. A separação não é organizacional — cada um tem uma
cadência de mudança e um gatilho de deploy diferente.

## `hermes-whitelabel-core`

Este repositório. Imagem, Admin API, infra, scripts, documentação.

- **Muda:** raramente (semanas)
- **Push na `main` dispara:** build da imagem → GHCR → deploy em staging
- **Nunca dispara:** deploy direto em cliente. Promoção é explícita, por
  cliente, mudando a tag no EasyPanel.

```
.github/workflows/build-image.yml   build + push para ghcr.io
admin-api/                          a API do plano B (+ 31 testes)
image/                              Dockerfile e serviço s6
infra/                              compose de referência, SQL, migrações
scripts/onboard-client.sh           onboarding fim a fim
docs/                               arquitetura e decisões
```

## `hermes-whitelabel-catalog`

Catálogo de skills do produto — a origem de tudo que a Admin API instala.

- **Muda:** toda semana
- **Push na `main` dispara:** build da imagem (as skills são assadas nela)

Se um dia o ritmo de mudança do catálogo incomodar o rebuild de imagem, o
caminho é montar o catálogo como volume em vez de assá-lo. Não faça isso
antes de doer: o catálogo dentro da imagem é o que garante que a skill
instalada veio de uma origem revisada, e não de um upload.

## `cliente-<slug>` (um por cliente)

`config.yaml`, `SOUL.md` e as skills específicas daquele cliente.

- **Muda:** conforme o cliente evolui
- **Push na `main` dispara:** redeploy só daquela instância

**Nenhum segredo entra aqui.** Credenciais chegam pela Admin API. Um `.env`
commitado é um incidente que sobrevive ao `git rm` — fica no histórico.

Para a Urban: `cliente-urban`.

---

## Deploy automático: o cuidado que importa

Push no core **não** pode redeployar todos os clientes de uma vez. Um bug que
sobe para 20 instâncias simultâneas é um incidente com 20 clientes.

```
push core/main → build ghcr.io/ORG/hermes-whitelabel:sha-abc123
                                                     :staging
               → deploy automático APENAS em staging
               → verificação manual
               → tag :stable
               → promoção por cliente, uma de cada vez
```

A Urban, como piloto, pode acompanhar `:stable` logo após a promoção — é o
que a torna útil como piloto. Clientes seguintes ficam uma versão atrás por
padrão.

É a mesma regra da tag fixada do upstream, um nível acima: **você** decide
quando cada cliente sobe de versão.

## Segredos no CI

Só um secret no GitHub Actions do core: `GHCR_TOKEN` (ou o `GITHUB_TOKEN`
nativo, que basta para push no GHCR da própria org).

Chaves do EasyPanel, do Postgres e do Keycloak **não** vão para o GitHub —
elas vivem no cofre da equipe e entram no ambiente só durante o
`onboard-client.sh`. O CI constrói imagem; ele não provisiona cliente.
