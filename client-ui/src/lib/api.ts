// Cliente da API do gateway do Hermes. Rotas confirmadas no upstream
// (gateway/platforms/api_server.py). Mesma origin em produção (cookie OIDC);
// em dev o Vite injeta o session-token via proxy.

export interface SessionSummary {
  session_id: string;
  title?: string;
  updated_at?: string;
  message_count?: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  ts?: string;
}

export interface ModelOption {
  id: string;
  label?: string;
  provider?: string;
}

export interface Project {
  id: string;
  name: string;
  count?: number;
}

export interface Account {
  name: string;
  email: string;
  plan?: string;
}

export interface RunApprovalRequest {
  run_id: string;
  kind: "approval" | "choice";
  prompt: string;
  options?: { id: string; label: string }[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include", // manda o cookie OIDC em produção
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (res.status === 401) throw new ApiError(401, "não autenticado");
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? await res.json() : (await res.text())) as T;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const api = {
  // --- Sessões ---
  listSessions: () => req<SessionSummary[]>("/api/sessions"),
  getMessages: (id: string) => req<ChatMessage[]>(`/api/sessions/${encodeURIComponent(id)}/messages`),
  sendChat: (id: string, content: string) =>
    req<{ ok: boolean; reply?: string }>(`/api/sessions/${encodeURIComponent(id)}/chat`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  listProjects: () => req<Project[]>("/api/projects"),
  getAccount: () => req<Account>("/api/account"),
  // Stream de resposta (SSE). Devolve o Response para o chamador ler o corpo.
  streamChat: (id: string, content: string, signal?: AbortSignal) =>
    fetch(`/api/sessions/${encodeURIComponent(id)}/chat/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      signal,
    }),

  // --- Models / tokens ---
  listModels: () => req<ModelOption[]>("/v1/models"),
  modelOptions: () => req<{ options: ModelOption[] }>("/api/model/options"),
  setSessionModel: (id: string, model: string) =>
    req<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}/model`, {
      method: "POST",
      body: JSON.stringify({ model }),
    }),

  // --- Aprovação / escolha (componente visual do chat web) ---
  answerApproval: (runId: string, choiceId: string) =>
    req<{ ok: boolean }>(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: "POST",
      body: JSON.stringify({ choice: choiceId }),
    }),

  health: () => req<{ status: string }>("/v1/health"),
};
