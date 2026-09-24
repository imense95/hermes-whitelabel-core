import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ErroOperacao } from "../api";
import { Moldura, Cartao, Botao } from "../componentes/ui";

// Tela de PRIMEIRA CARGA. Monta a base do painel (a estrutura que guarda o
// historico de mudancas e as aprovacoes). E' o unico lugar onde essa base pode
// ser criada, e sempre por clique — nunca comando. Guarda uma copia de
// seguranca antes. Linguagem 100% de operacao: nada de tabela/schema/SQL.

type Fase = "checando" | "pronta_ja" | "oferecer" | "criando" | "criada" | "erro";

export default function PrimeiraCarga() {
  const [fase, setFase] = useState<Fase>("checando");
  const [erro, setErro] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    api.statusBase()
      .then((s) => setFase(s.pronta ? "pronta_ja" : "oferecer"))
      .catch(() => setFase("oferecer")); // sem base ou fora do ar: oferece criar
  }, []);

  async function criar() {
    setFase("criando");
    setErro("");
    try {
      await api.primeiraCarga();
      setFase("criada");
    } catch (e) {
      setErro(e instanceof ErroOperacao ? e.message : "Nao foi possivel preparar a base agora.");
      setFase("erro");
    }
  }

  if (fase === "checando") {
    return <Moldura><Cartao><p className="text-text-50">Verificando…</p></Cartao></Moldura>;
  }

  if (fase === "pronta_ja") {
    return (
      <Moldura>
        <Cartao>
          <h1 className="text-xl font-bold text-title">Tudo pronto</h1>
          <p className="mt-2 text-text-100">
            A base do painel ja esta preparada. Nao ha nada a fazer aqui — as
            mudancas que precisarem da sua aprovacao vao aparecer para voce e
            voce recebe um aviso no Telegram com o link direto.
          </p>
        </Cartao>
      </Moldura>
    );
  }

  if (fase === "criada") {
    return (
      <Moldura>
        <Cartao>
          <h1 className="text-xl font-bold text-ok">Base preparada</h1>
          <p className="mt-2 text-text-100">
            Pronto. A partir de agora, toda mudanca importante passa a ser
            aplicada com copia de seguranca e so fica definitiva depois da sua
            aprovacao. Voce recebe um aviso no Telegram quando algo precisar de
            voce.
          </p>
        </Cartao>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <Cartao>
        <h1 className="text-xl font-bold text-title">Preparar o painel</h1>
        <p className="mt-2 text-text-100">
          Este e' o primeiro passo. Ele prepara a base que guarda o historico
          das mudancas e as suas aprovacoes. E' rapido e seguro: uma copia de
          seguranca e' feita antes de qualquer coisa.
        </p>
        <ul className="mt-4 space-y-2 text-text-100">
          <li className="flex gap-2"><span className="text-ok">✓</span> Copia de seguranca antes de aplicar</li>
          <li className="flex gap-2"><span className="text-ok">✓</span> Feito por voce, com um clique</li>
          <li className="flex gap-2"><span className="text-ok">✓</span> Pode ser desfeito se algo nao sair como esperado</li>
        </ul>

        {fase === "erro" && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-danger">{erro}</p>
        )}

        <div className="mt-6">
          {!confirmando ? (
            <Botao variante="primario" largura="cheia"
                   onClick={() => setConfirmando(true)}
                   disabled={fase === "criando"}>
              Preparar agora
            </Botao>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-text-100">
                Confirma preparar a base do painel agora?
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Botao variante="primario" largura="cheia" onClick={criar}
                       carregando={fase === "criando"}>
                  Sim, preparar
                </Botao>
                <Botao variante="neutro" largura="cheia"
                       onClick={() => setConfirmando(false)}
                       disabled={fase === "criando"}>
                  Agora nao
                </Botao>
              </div>
            </div>
          )}
        </div>

        <button className="mt-5 text-sm text-text-50 underline"
                onClick={() => nav("/primeira-carga")}>
          Atualizar
        </button>
      </Cartao>
    </Moldura>
  );
}
