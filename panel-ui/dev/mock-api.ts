import type { Plugin } from "vite";

// Backend de mentira para desenvolver e testar as telas SEM infra (sem banco,
// sem Keycloak, sem release-engine). Ativado com VITE_MOCK=1 (npm run dev:mock).
// Simula uma mudanca que caminha: aplicando -> aguardando; e aceita aprovar/
// reverter/primeira-carga. NAO vai para producao (so entra com o modo mock).

interface Ev { para: string; ator: string; detalhe: string }
interface Rel {
  id: number; tipo: string; alvo: string; descricao: string;
  classe: string; estado: string; health_ok: boolean | null;
  aguardando_desde: string | null; solicitada_por: string;
  confirmada_por: string | null; reverter_motivo: string | null; eventos: Ev[];
}

function novaRelease(id: number, classe = "auto"): Rel {
  return {
    id, tipo: "imagem", alvo: "sha-abc123", classe,
    descricao: classe === "manual"
      ? "Ajuste sensivel no cadastro de clientes"
      : "Atualizacao do aplicativo da Urban para a versao mais recente",
    estado: "aplicando", health_ok: null, aguardando_desde: null,
    solicitada_por: "voce", confirmada_por: null, reverter_motivo: null,
    eventos: [
      { para: "solicitada", ator: "voce", detalhe: "" },
      { para: "backup", ator: "sistema", detalhe: "" },
      { para: "aplicando", ator: "sistema", detalhe: "" },
    ],
  };
}

const db = new Map<number, Rel>();
db.set(1, novaRelease(1, "auto"));
db.set(2, novaRelease(2, "manual"));
let baseProta = false;

// Faz a #1 caminhar para 'aguardando' 3s apos o boot, para ver a transicao.
setTimeout(() => {
  const r = db.get(1);
  if (r && r.estado === "aplicando") {
    r.estado = "verificando";
    r.eventos.push({ para: "verificando", ator: "sistema", detalhe: "" });
    setTimeout(() => {
      r.estado = "provisoria";
      r.health_ok = true;
      r.aguardando_desde = new Date().toISOString();
      r.eventos.push({ para: "provisoria", ator: "sistema", detalhe: "" });
    }, 3000);
  }
}, 3000);

function json(res: any, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function mockApi(): Plugin {
  return {
    name: "mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        const m = req.method || "GET";
        if (!url.startsWith("/api/")) return next();

        if (url === "/api/v1/base/status" && m === "GET")
          return json(res, 200, { pronta: baseProta });

        if (url === "/api/v1/primeira-carga" && m === "POST") {
          baseProta = true;
          return json(res, 200, { ok: true, aplicados: ["base"], mensagem: "Base preparada." });
        }

        const mRel = url.match(/^\/api\/v1\/releases\/(\d+)(\/(confirm|revert))?$/);
        if (mRel) {
          const id = Number(mRel[1]);
          const r = db.get(id);
          if (!r) return json(res, 404, { detail: "Mudanca nao encontrada." });
          const acao = mRel[3];
          if (m === "GET") return json(res, 200, r);
          if (m === "POST" && acao === "confirm") {
            if (r.estado !== "provisoria")
              return json(res, 409, { detail: "Esta mudanca nao esta aguardando aprovacao." });
            r.estado = "consolidada"; r.confirmada_por = "voce";
            r.eventos.push({ para: "consolidada", ator: "voce", detalhe: "" });
            return json(res, 200, r);
          }
          if (m === "POST" && acao === "revert") {
            r.estado = "revertida"; r.reverter_motivo = "humano";
            r.eventos.push({ para: "revertida", ator: "voce", detalhe: "" });
            return json(res, 200, r);
          }
        }
        return json(res, 404, { detail: "Nao encontrado." });
      });
    },
  };
}
