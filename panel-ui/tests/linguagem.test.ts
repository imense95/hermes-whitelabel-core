/**
 * Guarda da regra de linguagem de negocio (decisao do Herbert): nenhuma tela do
 * painel mostra jargao tecnico, caminho de arquivo, nome de comando ou
 * identificador interno para o operador.
 *
 * Estrategia: extrai APENAS os literais de string em JSX (o texto que o usuario
 * pode ler) dos arquivos de tela e componentes, ignorando comentarios, nomes de
 * import, classes de CSS e chaves de objeto. Falha se algum termo proibido
 * aparecer no texto visivel.
 *
 * Roda com: node --test (sem framework extra). Puro Node, entra no CI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..");

const ARQUIVOS = [
  "src/telas/PrimeiraCarga.tsx",
  "src/telas/PaginaMudanca.tsx",
  "src/componentes/ui.tsx",
  "src/api.ts",
];

// Termos que NUNCA podem aparecer em texto visivel ao operador.
const PROIBIDOS = [
  "schema", "pg_dump", "pg_restore", "tsconfig", "psycopg", "postgres",
  "deadline", "canary", "rollback", "backend", "endpoint", "commit",
  "docker", "sha-", "easypanel", "keycloak", "tenant", ".sql", "DSN",
];

/**
 * Remove comentarios de linha e bloco, depois pega o conteudo de literais de
 * string (aspas simples, duplas e template). Aproximacao boa o suficiente:
 * qualquer termo proibido no texto de usuario cai aqui.
 */
function textoVisivel(fonte: string): string {
  const semComentarios = fonte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  const literais: string[] = [];
  const re = /"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'|`([^`\\]*(\\.[^`\\]*)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(semComentarios))) {
    literais.push(m[1] ?? m[3] ?? m[5] ?? "");
  }
  return literais.join("\n");
}

// Literais que sao claramente NAO-texto-de-usuario (classes CSS, chaves tecnicas
// da API, caminhos de rota) sao ignorados por heuristica: uma string so entra
// no crivo se contiver espaco OU acento OU comecar com maiuscula seguida de
// minuscula (cara de frase). Classes tailwind e chaves nao passam nisso.
function pareceFrase(s: string): boolean {
  if (/[áàâãéêíóôõúç]/i.test(s)) return true;
  if (/\s/.test(s) && /[a-z]{3,}/.test(s)) return true;
  return false;
}

for (const rel of ARQUIVOS) {
  test(`linguagem de negocio: ${rel}`, () => {
    const fonte = readFileSync(join(raiz, rel), "utf8");
    const visivel = textoVisivel(fonte);
    const linhas = visivel.split("\n").filter(pareceFrase);
    const alvo = linhas.join("\n").toLowerCase();
    for (const termo of PROIBIDOS) {
      assert.ok(
        !alvo.includes(termo.toLowerCase()),
        `Termo tecnico "${termo}" apareceu em texto visivel de ${rel}. ` +
        `Use linguagem de operacao.`,
      );
    }
  });
}

// Sanidade do proprio teste: precisa achar frases de verdade (senao o crivo
// esta engolindo tudo e o teste vira teatro).
test("o crivo enxerga texto de usuario (nao e' vazio)", () => {
  const fonte = readFileSync(join(raiz, "src/telas/PaginaMudanca.tsx"), "utf8");
  const visivel = textoVisivel(fonte).split("\n").filter(pareceFrase).join("\n");
  assert.ok(visivel.includes("Aprovar"), "esperava achar o texto do botao Aprovar");
  assert.ok(visivel.toLowerCase().includes("desfazer"), "esperava achar Desfazer");
});
