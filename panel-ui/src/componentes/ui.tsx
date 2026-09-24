import type { ReactNode } from "react";
import type { EstadoVisao } from "../api";

// Botao grande, touch-friendly (>=44px), com variantes de operacao.
export function Botao({
  children, onClick, variante = "neutro", disabled, carregando, largura,
}: {
  children: ReactNode;
  onClick?: () => void;
  variante?: "primario" | "aprovar" | "reverter" | "neutro";
  disabled?: boolean;
  carregando?: boolean;
  largura?: "auto" | "cheia";
}) {
  const base =
    "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 " +
    "text-base font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
    (largura === "cheia" ? "w-full " : "");
  const cores: Record<string, string> = {
    primario: "bg-primary text-white hover:bg-primary-hover",
    aprovar: "bg-ok text-white hover:brightness-95",
    reverter: "border-2 border-danger text-danger hover:bg-danger hover:text-white",
    neutro: "border border-stroke text-text-100 hover:bg-background-100",
  };
  return (
    <button className={base + cores[variante]} onClick={onClick}
            disabled={disabled || carregando}>
      {carregando ? "Um instante…" : children}
    </button>
  );
}

// Selo de estado, colorido pelo tom. Sem jargao: usa o rotulo traduzido.
export function SeloEstado({ visao }: { visao: EstadoVisao }) {
  const tons: Record<string, string> = {
    neutro: "bg-background-100 text-text-100",
    andamento: "bg-primary-light text-primary",
    aguardando: "bg-warn/15 text-warn",
    ok: "bg-ok/15 text-ok",
    desfeito: "bg-background-100 text-text-50",
    erro: "bg-danger/15 text-danger",
  };
  return (
    <span className={"inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold " + tons[visao.tom]}>
      <span className="h-2 w-2 rounded-full bg-current" />
      {visao.rotulo}
    </span>
  );
}

// Moldura da pagina: cabecalho enxuto + conteudo centrado e estreito (leitura
// confortavel no celular, retrato como padrao).
export function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full [min-height:100dvh] bg-background">
      <header className="pt-safe border-b border-stroke-light bg-panel px-4 pb-3">
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary" />
          <span className="text-base font-bold text-title">Painel da Assessoria</span>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6 pb-safe">{children}</main>
    </div>
  );
}

export function Cartao({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-stroke-light bg-panel p-5 shadow-card">
      {children}
    </div>
  );
}
