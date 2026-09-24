# panel-ui — Painel da Assessoria

Front-end do painel da assessoria (white-label). Fala com a `release-engine`
(via `/api`), atras do mesmo Keycloak. Servico proprio (subdominio admin).

## O que tem aqui (PR 4, parte 1)

Duas telas, o essencial para o operador operar:

- **Primeira carga** (`/primeira-carga`): prepara a base do painel com um clique,
  copia de seguranca antes. E' o unico lugar onde a base pode ser criada — nunca
  por comando.
- **Pagina da mudanca** (`/mudancas/:id`): destino do link do Telegram. Mostra o
  estado ao vivo e, quando a mudanca esta aguardando, os botoes **Aprovar** e
  **Desfazer**. Nada se desfaz pelo tempo; a mudanca espera a decisao humana.

A **listagem geral** de mudancas fica para a parte 2 (PR proprio).

## Regra de linguagem de negocio

Nenhuma tela mostra jargao tecnico, caminho de arquivo, nome de comando ou
identificador interno. A traducao de estados/motivos para linguagem de operacao
vive em `src/api.ts` (`visaoDoEstado`, `avisoDeClasse`). Um teste
(`tests/linguagem.test.ts`, roda no CI) falha se um termo tecnico vazar para o
texto visivel.

## Rodar

```
npm install
npm run dev:mock   # backend de mentira, sem infra — para desenvolver as telas
npm run build      # producao (tsc strict + vite)
npm run test       # guarda da linguagem + sanidade
```

`dev:mock` sobe um backend falso (`dev/mock-api.ts`) que simula uma mudanca
caminhando ate 'aguardando' e aceita aprovar/reverter/primeira-carga. Nunca vai
para producao (so entra com `--mode mock`).

## Ainda depende de voce (nao entra em codigo)

- Provisionar o servico `release-engine` no EasyPanel e as chaves (senha do
  banco, token, Telegram).
- Criar o bot do Telegram e pegar o `chat_id`.
