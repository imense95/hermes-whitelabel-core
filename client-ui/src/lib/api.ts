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

// Onboarding do WhatsApp (rotas reais do upstream em /api/messaging/*).
export interface WaOnboardingStart { pairing_id: string; }
export interface WaOnboardingStatus {
  pairing_id: string;
  status: "starting" | "awaiting_qr" | "qr" | "connected" | "expired";
  qr_payload?: string | null;
  account_phone?: string | null;
  account_name?: string | null;
  error?: string | null;
}
// Onboarding do Telegram (deep-link + QR via serviço de pairing).
export interface TgOnboardingStart {
  pairing_id: string;
  deep_link: string;
  qr_payload: string;
  suggested_username?: string;
}
export interface TgOnboardingStatus {
  status: string; // "pending" | "connected" | ...
  username?: string;
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

  // --- Canais / mensageria (rotas reais do upstream: /api/messaging/*) ---
  // Servidas na mesma origin do dashboard, atrás do gate OIDC (cookie Keycloak).
  messagingPlatforms: () => req<any>("/api/messaging/platforms"),

  // WhatsApp: onboarding self-contained (bridge Baileys em --pair-only).
  waStart: () =>
    req<WaOnboardingStart>("/api/messaging/whatsapp/onboarding/start", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  waStatus: (pairingId: string) =>
    req<WaOnboardingStatus>(`/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`),
  waApply: (pairingId: string) =>
    req<{ ok: boolean; needs_restart?: boolean }>(
      `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}/apply`,
      { method: "POST", body: JSON.stringify({}) },
    ),

  // Telegram: onboarding por deep-link + QR (serviço de pairing do @BotFather).
  tgStart: (botName?: string) =>
    req<TgOnboardingStart>("/api/messaging/telegram/onboarding/start", {
      method: "POST",
      body: JSON.stringify({ bot_name: botName || "Hermes Agent" }),
    }),
  tgStatus: (pairingId: string) =>
    req<TgOnboardingStatus>(`/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}`),
  tgApply: (pairingId: string) =>
    req<{ ok: boolean; needs_restart?: boolean }>(
      `/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}/apply`,
      { method: "POST", body: JSON.stringify({}) },
    ),

  health: () => req<{ status: string }>("/v1/health"),
};
