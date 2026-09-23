import { useEffect, useState } from "react";
import { api, modelLabel, type AuthMe, type ModelOptionsResponse, type StatusResponse } from "../lib/api";
import { TelegramTab } from "../tabs/TelegramTab";
import { WhatsAppTab } from "../tabs/WhatsAppTab";

type Section = "account" | "models" | "telegram" | "whatsapp";

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: "account", label: "Conta", icon: "👤" },
  { id: "models", label: "Modelos", icon: "✳" },
  { id: "telegram", label: "Telegram", icon: "✈" },
  { id: "whatsapp", label: "WhatsApp", icon: "⬤" },
];

export function SettingsModal({ open, onClose, account }: { open: boolean; onClose: () => void; account: AuthMe | null }) {
  const initial = (new URLSearchParams(window.location.search).get("section") as Section) || "account";
  const [section, setSection] = useState<Section>(NAV.some((n) => n.id === initial) ? initial : "account");
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/40 md:items-center md:p-4" onClick={onClose}>
      <div className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-panel md:h-[560px] md:max-w-3xl md:flex-row md:rounded-2xl md:shadow-pop" onClick={(e) => e.stopPropagation()}>
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-stroke bg-background p-2 pt-safe md:w-52 md:flex-col md:gap-0 md:border-b-0 md:border-r md:p-3 md:pt-3">
          <p className="side-label hidden md:block">Configurações</p>
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setSection(n.id)}
              className={["flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition hover:bg-background-100 md:w-full",
                section === n.id ? "bg-background-100 font-medium text-title" : "text-text-100"].join(" ")}>
              <span aria-hidden>{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-safe">
          <header className="flex items-center justify-between border-b border-stroke px-4 py-4 md:px-6">
            <h2 className="text-lg font-semibold text-title">{NAV.find((n) => n.id === section)?.label}</h2>
            <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-text-50 hover:bg-background-100 hover:text-title" title="Fechar">✕</button>
          </header>
          <div className="p-4 md:p-6">
            {section === "account" && <AccountSection account={account} />}
            {section === "models" && <ModelsSection />}
            {section === "telegram" && <TelegramTab />}
            {section === "whatsapp" && <WhatsAppTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ title, desc, action }: { title: string; desc?: string | null; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stroke py-4 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-title">{title}</p>
        {desc && <p className="mt-0.5 break-words text-xs text-text-50">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// Conta = identidade OIDC (Keycloak) lida de /api/auth/me. Nome/e-mail são
// geridos no IdP pela equipe; aqui só exibição e sair.
function AccountSection({ account }: { account: AuthMe | null }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  useEffect(() => { api.status().then(setStatus).catch(() => setStatus(null)); }, []);
  const name = account?.display_name || account?.email || "Cliente";
  const gated = !!status?.auth_required;
  return (
    <div>
      <div className="flex items-center gap-4 pb-2">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">{name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-title">{name}</p>
          <p className="truncate text-sm text-text-50">{account?.email || (gated ? "—" : "modo local, sem login")}</p>
        </div>
      </div>
      <Row title="Nome" desc={account?.display_name || "—"} />
      <Row title="E-mail" desc={account?.email || "—"} />
      <Row title="Provedor de login" desc={account?.provider || (gated ? "—" : "nenhum (dev)")} />
      <Row title="Versão do assistente" desc={status?.version ? `Hermes ${status.version}` : "—"} />
      <Row title="Sair" desc="Encerrar a sessão neste dispositivo"
        action={<button className="btn-outline" onClick={() => api.logout()} disabled={!gated} title={gated ? "" : "Sem login em modo local"}>Sair</button>} />
    </div>
  );
}

// Modelos = GET /api/model/options: provedores autenticados + seus modelos.
// Só visualização nesta fatia. A chave é cadastrada pela equipe (Admin API).
function ModelsSection() {
  const [data, setData] = useState<ModelOptionsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.modelOptions().then((r) => setData(r && Array.isArray(r.providers) ? r : { providers: [], model: "", provider: "" }))
      .catch((e) => setErr(e?.message || "falha ao carregar"));
  }, []);
  const provs = (data?.providers || []).filter((p) => p.authenticated !== false);
  return (
    <div>
      <p className="mb-4 text-sm text-text-50">
        Modelos disponíveis nesta instância. A chave de API é cadastrada pela equipe na configuração do servidor — nunca digitada aqui.
      </p>
      {data?.model && (
        <div className="mb-4 rounded-xl border border-primary/30 bg-primary-light px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-primary">Modelo em uso</p>
          <p className="text-sm font-medium text-title">{modelLabel(data.model)} <span className="text-text-50">· {data.provider}</span></p>
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!err && !data && <p className="text-sm text-text-50">Carregando…</p>}
      {data && provs.length === 0 && <p className="rounded-xl border border-stroke px-4 py-3 text-sm text-text-50">Nenhum provedor configurado.</p>}
      {provs.map((p) => (
        <div key={p.slug} className="mb-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-50">{p.name || p.slug} {p.is_current && <span className="ml-1 rounded-full bg-primary-light px-2 py-0.5 text-[10px] text-primary">atual</span>}</p>
          <ul className="divide-y divide-stroke rounded-xl border border-stroke">
            {(p.models || []).length === 0 && <li className="px-4 py-3 text-sm text-text-50">Sem modelos listados.</li>}
            {(p.models || []).map((m) => (
              <li key={m} className="flex items-center justify-between px-4 py-2.5">
                <p className="text-sm text-title">{modelLabel(m)}</p>
                {m === data?.model && p.is_current ? <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white">em uso</span>
                  : <span className="rounded-full bg-background-100 px-3 py-1 text-xs text-text-50">disponível</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
