// Cliente da release-engine/panel-api. Uma unica porta de entrada para o
// backend, e o lugar onde a LINGUAGEM DE NEGOCIO e' garantida: nada de
// 'schema', 'tag', 'sha-', caminho de arquivo ou identificador interno vaza
// para a tela. A API ja devolve 'descricao' legivel; aqui traduzimos estados e
// motivos para as palavras que o operador ve.

export type EstadoApi =
  | "solicitada" | "backup" | "aplicando" | "verificando"
  | "provisoria" | "consolidada" | "revertida" | "falha";

export interface EventoApi {
  para: string;
  ator: string;
  detalhe: string;
}

export interface ReleaseApi {
  id: number;
  tipo: "migracao" | "imagem";
  alvo: string;            // identificador interno — NAO exibir cru
  descricao: string;      // legivel, vem pronta do backend
  classe: "auto" | "manual";
  estado: EstadoApi;
  health_ok: boolean | null;
  aguardando_desde: string | null;
  solicitada_por: string;
  confirmada_por: string | null;
  reverter_motivo: string | null;
  eventos: EventoApi[];
}

// --- traducao para linguagem de operacao ---------------------------------

export interface EstadoVisao {
  rotulo: string;         // o que o operador le
  tom: "neutro" | "andamento" | "aguardando" | "ok" | "desfeito" | "erro";
  ajuda: string;          // uma linha de contexto, sem jargao
}

export function visaoDoEstado(r: ReleaseApi): EstadoVisao {
  switch (r.estado) {
    case "solicitada":
      return { rotulo: "Pronta para aplicar", tom: "neutro",
               ajuda: "A mudanca esta preparada. Nada foi aplicado ainda." };
    case "backup":
    case "aplicando":
    case "verificando":
      return { rotulo: "Aplicando com seguranca", tom: "andamento",
               ajuda: "Guardando uma copia de seguranca e aplicando a mudanca." };
    case "provisoria":
      return { rotulo: "Aplicada, aguardando sua aprovacao", tom: "aguardando",
               ajuda: "A mudanca esta no ar em carater provisorio. Nada fica definitivo ate voce aprovar. Sem pressa: ela espera por voce." };
    case "consolidada":
      return { rotulo: "Aprovada", tom: "ok",
               ajuda: "Voce aprovou. A mudanca esta valendo em definitivo." };
    case "revertida":
      return { rotulo: motivoRevertido(r), tom: "desfeito",
               ajuda: "O estado anterior foi restaurado a partir da copia de seguranca." };
    case "falha":
      return { rotulo: "Nao foi possivel aplicar", tom: "erro",
               ajuda: "A mudanca nao subiu e o estado anterior foi mantido." };
  }
}

function motivoRevertido(r: ReleaseApi): string {
  if (r.reverter_motivo === "humano") return "Desfeita por voce";
  if (r.reverter_motivo === "health") return "Desfeita automaticamente (a verificacao nao passou)";
  if (r.reverter_motivo === "aplicacao") return "Desfeita automaticamente (a mudanca nao subiu)";
  return "Desfeita";
}

// Uma mudanca 'manual' pela taxonomia = mudanca sensivel que a assessoria
// trata em etapas. O operador nao ve 'expand/contract' nem 'destrutivo'.
export function avisoDeClasse(r: ReleaseApi): string | null {
  if (r.classe === "manual") {
    return "Esta e' uma mudanca sensivel. Por seguranca, ela nao entra no fluxo automatico — a assessoria conduz em etapas.";
  }
  return null;
}

// --- chamadas HTTP -------------------------------------------------------

const BASE = "/api/v1";

async function req<T>(metodo: string, caminho: string): Promise<T> {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    credentials: "include", // cookie do Keycloak flui sozinho na mesma origin
  });
  if (!r.ok) {
    let msg = "Nao foi possivel completar a acao.";
    try {
      const j = await r.json();
      if (j && typeof j.detail === "string") msg = j.detail;
    } catch { /* corpo nao-JSON: mantem a mensagem generica */ }
    throw new ErroOperacao(msg, r.status);
  }
  return r.json() as Promise<T>;
}

export class ErroOperacao extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

export const api = {
  verRelease: (id: number) => req<ReleaseApi>("GET", `/releases/${id}`),
  aprovar: (id: number) => req<ReleaseApi>("POST", `/releases/${id}/confirm`),
  reverter: (id: number) => req<ReleaseApi>("POST", `/releases/${id}/revert`),
  primeiraCarga: () => req<{ ok: boolean; aplicados: string[]; mensagem: string }>(
    "POST", `/primeira-carga`),
  // estado da base do painel: existe ou precisa de primeira carga?
  statusBase: () => req<{ pronta: boolean }>("GET", `/base/status`),
};
