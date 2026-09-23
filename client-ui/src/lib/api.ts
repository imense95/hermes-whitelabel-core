// Cliente REST do DASHBOARD do Hermes (porta 9119) — o que a instância do
// cliente expõe atrás do Traefik. Rotas e FORMAS conferidas no upstream na tag
// v2026.9.21 (hermes_cli/web_routers/*.py, hermes_cli/dashboard_auth/routes.py).
//
// ARMADILHA que custou a fatia 1: as rotas /v1/* e /api/sessions/{id}/chat*
// pertencem ao api_server (porta 8642), que NÃO está exposto. No dashboard,
// chat é WebSocket JSON-RPC em /api/ws (ver lib/gateway.ts). E o dashboard
// NÃO usa o envelope {object:"list", data:[...]} do api_server: cada rota tem
// sua chave própria (sessions, messages, providers...). Nada de unwrap mágico.
//
// Auth: em produção, cookie OIDC (Keycloak) na mesma origin; em dev, o proxy
// do Vite injeta X-Hermes-Session-Token. Sem cookie, /api/* responde
// 401 {error:"unauthenticated", login_url:"/login"} (JSON) — nunca HTML.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// --- Formas reais (dashboard) ------------------------------------------------

/** Linha de GET /api/sessions (hermes_state_sessions.list_sessions_rich + web_routers/sessions.py). */
export interface SessionRow {
  id: string;
  title?: string | null;
  preview?: string | null;
  started_at?: number | null;
  ended_at?: number | null;
  last_active?: number | null;
  message_count?: number | null;
  source?: string | null;
  model?: string | null;
  archived?: boolean;
  pinned?: boolean;
  is_active?: boolean;
  profile?: string;
}
export interface SessionListResponse {
  sessions: SessionRow[];
  total: number;
  limit: number;
  offset: number;
}

/** Linha de GET /api/sessions/{id}/messages (linhas do SQLite projetadas p/ exibição). */
export interface StoredMessage {
  id?: number;
  role: "user" | "assistant" | "system" | "tool";
  content?: string | null;
  display_content?: string | null;
  display_kind?: string | null; // "hidden" = não mostrar
  timestamp?: number | null;
  tool_name?: string | null;
  [k: string]: unknown;
}
export interface MessagesResponse {
  session_id: string;
  profile?: string;
  messages: StoredMessage[];
  pagination: { limit: number; offset: number; order: string; returned: number };
}

/** GET /api/model/options (hermes_cli/inventory.build_model_options_payload). */
export interface ModelProvider {
  slug: string;
  name: string;
  models: string[];
  authenticated?: boolean | null;
  is_current?: boolean | null;
  featured_models?: string[] | null;
  [k: string]: unknown;
}
export interface ModelOptionsResponse {
  providers: ModelProvider[];
  model: string;
  provider: string;
}

/** GET /api/auth/me (dashboard_auth/routes.py) — só existe atrás do gate OIDC. */
export interface AuthMe {
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  org_id?: string | null;
  provider?: string;
  expires_at?: number | null;
}

/** GET /api/status (público; web_routers/status.py). Só os campos que usamos. */
export interface StatusResponse {
  version?: string;
  auth_required?: boolean;
  gateway_running?: boolean;
  [k: string]: unknown;
}

/** POST /api/chat/image-upload (web_routers/files.py). */
export interface ImageUploadResponse {
  ok: boolean;
  path: string;
  name: string;
  bytes: number;
  mime_type: string;
}

// --- Onboarding de canais (fatia 2; formas já alinhadas ao upstream) --------
export interface WaOnboardingStart {
  pairing_id: string;
  status?: "starting" | "awaiting_qr" | "qr" | "connected" | "expired";
  account_phone?: string | null;
}
export interface WaOnboardingStatus {
  pairing_id: string;
  status: "starting" | "awaiting_qr" | "qr" | "connected" | "expired";
  qr_payload?: string | null;
  account_phone?: string | null;
  account_name?: string | null;
  error?: string | null;
}
export interface TgOnboardingStart {
  pairing_id: string;
  deep_link: string;
  qr_payload: string;
  suggested_username?: string;
}
export interface TgOnboardingStatus {
  status: string;
  username?: string;
}

// --- Núcleo HTTP ------------------------------------------------------------

function redirectToLogin(loginUrl = "/login") {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`${loginUrl}?next=${next}`);
}

type ReqOpts = RequestInit & { noRedirect?: boolean };

async function req<T>(path: string, init?: ReqOpts): Promise<T> {
  const { noRedirect, ...fetchInit } = init || {};
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(fetchInit.headers || {}) },
    ...fetchInit,
  });
  if (res.status === 401 || res.status === 403) {
    // Só o gate OIDC devolve {error:"unauthenticated", login_url}. Um 401 sem
    // login_url (ex.: /api/auth/me fora do gate, em dev) NÃO é "deslogado" —
    // redirecionar aqui recarregava a página no meio do session.resume.
    let loginUrl: string | null = null;
    try {
      const j = await res.clone().json();
      if (j && typeof j.login_url === "string") loginUrl = j.login_url;
    } catch { /* corpo não-JSON */ }
    if (loginUrl && !noRedirect) redirectToLogin(loginUrl);
    throw new ApiError(res.status, "não autenticado");
  }
  const ct = res.headers.get("content-type") || "";
  // O gate OIDC responde 302 -> /login para rotas fora de /api (ex.: /v1/*);
  // o fetch segue o redirect e chega com 200 + HTML. Nunca devolver HTML
  // como dados: qualquer .map em cima disso estoura.
  const redirectedToLogin = res.redirected && /\/login(\?|$)/.test(res.url);
  if (redirectedToLogin || ct.includes("text/html")) {
    redirectToLogin();
    throw new ApiError(401, "sessão expirada — redirecionando para o login");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.clone().json();
      detail = (j && (j.detail || j.error || j.message)) || detail;
    } catch { detail = (await res.text().catch(() => "")) || detail; }
    throw new ApiError(res.status, String(detail));
  }
  if (res.status === 204) return undefined as T;
  return (ct.includes("application/json") ? await res.json() : await res.text()) as T;
}

export const api = {
  // --- Público (sem cookie) ---
  status: () => req<StatusResponse>("/api/status"),

  // --- Identidade / auth (gate OIDC) ---
  me: () => req<AuthMe>("/api/auth/me", { noRedirect: true }),
  wsTicket: () => req<{ ticket: string; ttl_seconds: number }>("/api/auth/ws-ticket", { method: "POST" }),
  /** Logout é um POST que responde 302 -> /login e limpa os cookies. Form submit para o browser seguir. */
  logout: () => {
    const f = document.createElement("form");
    f.method = "POST";
    f.action = "/auth/logout";
    document.body.appendChild(f);
    f.submit();
  },

  // --- Sessões (leitura; escrita/chat vai pelo WS) ---
  listSessions: (opts: { limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams({
      limit: String(opts.limit ?? 50),
      offset: String(opts.offset ?? 0),
      order: "recent",
      // O cliente final só vê conversas humanas dele, não jobs de cron/subagentes.
      exclude_sources: "cron,subagent,kanban",
    });
    return req<SessionListResponse>(`/api/sessions?${q}`);
  },
  getMessages: (id: string) => req<MessagesResponse>(`/api/sessions/${encodeURIComponent(id)}/messages`),
  /** GET /api/sessions/search -> {results:[{id,title,preview,snippet,last_active,...}]} (FTS5 + id). */
  searchSessions: (qtext: string, limit = 20) =>
    req<{ results: (SessionRow & { snippet?: string })[] }>(
      `/api/sessions/search?${new URLSearchParams({ q: qtext, limit: String(limit), exclude_sources: "cron,subagent,kanban" })}`,
    ),
  deleteSession: (id: string) => req<unknown>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // --- Modelos (só visualização nesta fatia) ---
  modelOptions: () => req<ModelOptionsResponse>("/api/model/options"),

  // --- Upload de imagem (clipboard/arquivo -> caminho visível ao gateway) ---
  uploadImage: (dataUrl: string, filename?: string) =>
    req<ImageUploadResponse>("/api/chat/image-upload", {
      method: "POST",
      body: JSON.stringify({ data_url: dataUrl, filename }),
    }),

  // --- Canais / mensageria (/api/messaging/*) ---
  messagingPlatforms: () => req<any>("/api/messaging/platforms"),
  waStart: () => req<WaOnboardingStart>("/api/messaging/whatsapp/onboarding/start", { method: "POST", body: "{}" }),
  waStatus: (pairingId: string) => req<WaOnboardingStatus>(`/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`),
  waApply: (pairingId: string) =>
    req<{ ok: boolean; needs_restart?: boolean }>(`/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}/apply`, { method: "POST", body: "{}" }),
  tgStart: (botName?: string) =>
    req<TgOnboardingStart>("/api/messaging/telegram/onboarding/start", { method: "POST", body: JSON.stringify({ bot_name: botName || "Hermes Agent" }) }),
  tgStatus: (pairingId: string) => req<TgOnboardingStatus>(`/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}`),
  tgApply: (pairingId: string) =>
    req<{ ok: boolean; needs_restart?: boolean }>(`/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}/apply`, { method: "POST", body: "{}" }),
};

// --- Helpers de exibição ----------------------------------------------------

/** Texto exibível de uma linha do histórico (display_content vence content). */
export function messageText(m: StoredMessage): string {
  const v = m.display_content ?? m.content ?? "";
  if (typeof v === "string") return v;
  // content pode ser lista de partes (multimodal) — junta os textos.
  if (Array.isArray(v)) return (v as any[]).map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  return "";
}

/** Rótulo do modelo para o seletor: "provider/modelo" -> só o modelo. */
export function modelLabel(id: string): string {
  return id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
}
