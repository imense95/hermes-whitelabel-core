import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  api, ErroOperacao, visaoDoEstado, avisoDeClasse, type ReleaseApi,
} from "../api";
import { Moldura, Cartao, Botao, SeloEstado } from "../componentes/ui";

// PAGINA DA MUDANCA — o coracao do painel para o operador. E' o destino do link
// que chega no Telegram. Mostra o estado ao vivo e, quando a mudanca esta
// aguardando, os dois botoes: Aprovar e Desfazer. Sem jargao: so a descricao
// legivel e as palavras de operacao.

type AcaoFase = "idle" | "confirmando_aprovar" | "confirmando_reverter" | "enviando";

export default function PaginaMudanca() {
  const { id } = useParams();
  const releaseId = Number(id);
  const [rel, setRel] = useState<ReleaseApi | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [acao, setAcao] = useState<AcaoFase>("idle");
  const [erroAcao, setErroAcao] = useState("");

  const carregar = useCallback(async () => {
    try {
      setRel(await api.verRelease(releaseId));
      setErroCarga("");
    } catch (e) {
      setErroCarga(e instanceof ErroOperacao && e.status === 404
        ? "Nao encontramos essa mudanca. O link pode ter expirado."
        : "Nao foi possivel carregar agora. Tente atualizar.");
    }
  }, [releaseId]);

  useEffect(() => { carregar(); }, [carregar]);

  // Enquanto esta 'em andamento', atualiza sozinho a cada 4s para o operador
  // ver a mudanca chegar em 'aguardando' sem recarregar a pagina.
  useEffect(() => {
    if (!rel) return;
    const emMovimento = ["solicitada", "backup", "aplicando", "verificando"].includes(rel.estado);
    if (!emMovimento) return;
    const t = setInterval(carregar, 4000);
    return () => clearInterval(t);
  }, [rel, carregar]);

  async function executar(qual: "aprovar" | "reverter") {
    setAcao("enviando");
    setErroAcao("");
    try {
      const novo = qual === "aprovar"
        ? await api.aprovar(releaseId)
        : await api.reverter(releaseId);
      setRel(novo);
      setAcao("idle");
    } catch (e) {
      setErroAcao(e instanceof ErroOperacao ? e.message : "Nao foi possivel completar a acao.");
      setAcao("idle");
    }
  }

  if (erroCarga) {
    return <Moldura><Cartao><p className="text-danger">{erroCarga}</p>
      <div className="mt-4"><Botao variante="neutro" onClick={carregar}>Atualizar</Botao></div>
    </Cartao></Moldura>;
  }
  if (!rel) {
    return <Moldura><Cartao><p className="text-text-50">Carregando…</p></Cartao></Moldura>;
  }

  const visao = visaoDoEstado(rel);
  const aviso = avisoDeClasse(rel);
  const aguardando = rel.estado === "provisoria";

  return (
    <Moldura>
      <Cartao>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-title break-words">{rel.descricao}</h1>
        </div>
        <div className="mt-3"><SeloEstado visao={visao} /></div>
        <p className="mt-3 text-text-100">{visao.ajuda}</p>

        {aviso && (
          <p className="mt-4 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{aviso}</p>
        )}

        {aguardando && (
          <div className="mt-6">
            {erroAcao && (
              <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{erroAcao}</p>
            )}

            {acao === "idle" && (
              <div className="flex flex-col gap-3 sm:flex-row">
                <Botao variante="aprovar" largura="cheia"
                       onClick={() => setAcao("confirmando_aprovar")}>
                  Aprovar mudanca
                </Botao>
                <Botao variante="reverter" largura="cheia"
                       onClick={() => setAcao("confirmando_reverter")}>
                  Desfazer
                </Botao>
              </div>
            )}

            {acao === "confirmando_aprovar" && (
              <Confirmacao
                titulo="Aprovar esta mudanca?"
                texto="Ela passa a valer em definitivo. Voce ainda podera pedir uma nova mudanca depois, se precisar."
                rotuloSim="Sim, aprovar" varianteSim="aprovar"
                onSim={() => executar("aprovar")}
                onNao={() => setAcao("idle")} />
            )}

            {acao === "confirmando_reverter" && (
              <Confirmacao
                titulo="Desfazer esta mudanca?"
                texto="O estado anterior sera restaurado a partir da copia de seguranca. E' a opcao segura se algo parece errado."
                rotuloSim="Sim, desfazer" varianteSim="reverter"
                onSim={() => executar("reverter")}
                onNao={() => setAcao("idle")} />
            )}

            {acao === "enviando" && (
              <p className="text-text-50">Um instante…</p>
            )}
          </div>
        )}

        <LinhaDoTempo rel={rel} />

        <div className="mt-6">
          <Botao variante="neutro" onClick={carregar}>Atualizar</Botao>
        </div>
      </Cartao>
    </Moldura>
  );
}

function Confirmacao({
  titulo, texto, rotuloSim, varianteSim, onSim, onNao,
}: {
  titulo: string; texto: string; rotuloSim: string;
  varianteSim: "aprovar" | "reverter"; onSim: () => void; onNao: () => void;
}) {
  return (
    <div className="rounded-xl border border-stroke-light bg-background-100 p-4">
      <p className="font-semibold text-title">{titulo}</p>
      <p className="mt-1 text-sm text-text-100">{texto}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Botao variante={varianteSim} largura="cheia" onClick={onSim}>{rotuloSim}</Botao>
        <Botao variante="neutro" largura="cheia" onClick={onNao}>Cancelar</Botao>
      </div>
    </div>
  );
}

// Historico legivel dos passos. Traduz cada evento; nunca mostra ator interno
// nem detalhe tecnico cru.
function LinhaDoTempo({ rel }: { rel: ReleaseApi }) {
  if (!rel.eventos?.length) return null;
  const legenda: Record<string, string> = {
    solicitada: "Mudanca preparada",
    backup: "Copia de seguranca feita",
    aplicando: "Aplicando a mudanca",
    verificando: "Conferindo se esta tudo bem",
    provisoria: "Aplicada, aguardando sua aprovacao",
    consolidada: "Aprovada por voce",
    revertida: "Desfeita",
    falha: "Nao foi possivel aplicar",
  };
  return (
    <div className="mt-6 border-t border-stroke-light pt-4">
      <p className="mb-3 text-sm font-semibold text-text-50">Historico</p>
      <ol className="space-y-2">
        {rel.eventos.map((ev, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-stroke" />
            <span className="text-text-100">{legenda[ev.para] ?? "Atualizacao"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
