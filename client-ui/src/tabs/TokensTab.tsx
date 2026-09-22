import { useEffect, useState } from "react";
import { api, type ModelOption } from "../lib/api";

// Aba de configuração de tokens / modelo do LLM. A CHAVE em si nunca passa por
// aqui digitada no front — ela entra pela tela de env da instância (regra do
// projeto). Esta aba escolhe QUAL modelo/provedor usar entre os já configurados.
export function TokensTab() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listModels()
      .then((m) => setModels(Array.isArray(m) ? m : []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="tg-card">
        <h2 className="text-base font-semibold text-dark">Provedor e modelo</h2>
        <p className="mt-1 text-sm text-body">
          Modelos disponíveis nesta instância. A chave de API é cadastrada pela
          equipe na configuração do servidor — nunca digitada aqui.
        </p>
        <div className="mt-4">
          {loading && <div className="h-10 animate-pulse rounded bg-surface" />}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && (
            <ul className="divide-y divide-stroke rounded-md border border-stroke">
              {models.length === 0 && (
                <li className="px-4 py-3 text-sm text-body">
                  Nenhum modelo configurado. Peça à equipe para cadastrar a chave.
                </li>
              )}
              {models.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-dark">{m.label || m.id}</p>
                    {m.provider && <p className="text-xs text-body">{m.provider}</p>}
                  </div>
                  <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-medium text-primary">
                    disponível
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
