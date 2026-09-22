import { useEffect, useState } from "react";
import { api, type Account, type ModelOption } from "../lib/api";
import { TelegramTab } from "../tabs/TelegramTab";
import { WhatsAppTab } from "../tabs/WhatsAppTab";

type Section = "account" | "models" | "telegram" | "whatsapp";

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: "account", label: "Conta", icon: "👤" },
  { id: "models", label: "Modelos", icon: "✳" },
  { id: "telegram", label: "Telegram", icon: "✈" },
  { id: "whatsapp", label: "WhatsApp", icon: "⬤" },
];

// Modal de configurações — espelha o modal "Account" do demo AIChat, com uma
// barra lateral de seções. Reúne Conta, Modelos (tokens) e os canais.
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const initial = (new URLSearchParams(window.location.search).get("section") as Section) || "account";
  const [section, setSection] = useState<Section>(
    NAV.some((n) => n.id === initial) ? initial : "account",
  );
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex h-[560px] w-full max-w-3xl overflow-hidden rounded-2xl bg-panel shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="w-52 shrink-0 border-r border-stroke bg-background p-3">
          <p className="side-label">Configurações</p>
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setSection(n.id)}
              className={["side-item", section === n.id ? "side-item-active" : ""].join(" ")}
            >
              <span aria-hidden>{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto">
          <header className="flex items-center justify-between border-b border-stroke px-6 py-4">
            <h2 className="text-lg font-semibold text-title">{NAV.find((n) => n.id === section)?.label}</h2>
            <button onClick={onClose} className="text-text-50 hover:text-title" title="Fechar">✕</button>
          </header>
          <div className="p-6">
            {section === "account" && <AccountSection />}
            {section === "models" && <ModelsSection />}
            {section === "telegram" && <TelegramTab />}
            {section === "whatsapp" && <WhatsAppTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ title, desc, action }: { title: string; desc?: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-stroke py-4 last:border-0">
      <div>
        <p className="text-sm font-medium text-title">{title}</p>
        {desc && <p className="mt-0.5 text-xs text-text-50">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

function AccountSection() {
  const [acc, setAcc] = useState<Account | null>(null);
  useEffect(() => {
    api.getAccount().then(setAcc).catch(() => setAcc(null));
  }, []);
  return (
    <div>
      <div className="flex items-center gap-4 pb-2">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
          {(acc?.name || "U").slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="text-base font-semibold text-title">{acc?.name || "Cliente"}</p>
          <p className="text-sm text-text-50">{acc?.email || "—"}</p>
        </div>
      </div>
      <Row title="Nome" desc={acc?.name} action={<button className="btn-outline">Editar</button>} />
      <Row title="E-mail" desc={acc?.email} action={<button className="btn-outline">Alterar</button>} />
      <Row title="Plano" desc={acc?.plan || "Ativo"} action={<span className="rounded-full bg-primary-light px-3 py-1 text-xs font-medium text-primary">ativo</span>} />
      <Row title="Sair" desc="Encerrar a sessão neste dispositivo" action={<button className="btn-outline">Sair</button>} />
    </div>
  );
}

function ModelsSection() {
  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => {
    api.listModels()
      .then((m) => setModels(Array.isArray(m) ? m : []))
      .catch(() => setModels([]));
  }, []);
  return (
    <div>
      <p className="mb-4 text-sm text-text-50">
        Modelos disponíveis nesta instância. A chave de API é cadastrada pela equipe
        na configuração do servidor — nunca digitada aqui.
      </p>
      <ul className="divide-y divide-stroke rounded-xl border border-stroke">
        {models.length === 0 && <li className="px-4 py-3 text-sm text-text-50">Nenhum modelo configurado.</li>}
        {models.map((m) => (
          <li key={m.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-title">{m.label || m.id}</p>
              {m.provider && <p className="text-xs text-text-50">{m.provider}</p>}
            </div>
            <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-medium text-primary">disponível</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
