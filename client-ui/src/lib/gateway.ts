// Cliente JSON-RPC sobre WebSocket para o gateway do dashboard (/api/ws).
// Protocolo conferido em tui_gateway/ws.py + server.py + server_requests.py e
// no contrato apps/shared/src/gateway-contract.openrpc.json (tag v2026.9.21):
//
//   cliente -> servidor : {jsonrpc:"2.0", id:<int>, method, params}
//   resposta            : {jsonrpc:"2.0", id:<int>, result} | {..., error:{code,message}}
//   evento (notificação): {jsonrpc:"2.0", method:"event", params:{type, session_id, payload?, seq?}}
//   servidor -> cliente : {jsonrpc:"2.0", id:"srq-xxxx", method:"approval"|"clarify"|..., params}
//                         o cliente responde {jsonrpc:"2.0", id:"srq-xxxx", result:{...}}
//
// Auth atrás do gate OIDC: POST /api/auth/ws-ticket -> {ticket} (30 s, uso único)
// e abre wss://<origin>/api/ws?ticket=... . Em dev (loopback, sem gate) o
// dashboard aceita ?token=<HERMES_DASHBOARD_SESSION_TOKEN>; o Vite não faz
// proxy de WS com header, então em dev o token vai por VITE_SESSION_TOKEN.
//
// Primeiro frame do servidor é o evento gateway.ready. Depois dele o cliente
// DEVE mandar client.capabilities {server_requests:true} — sem isso o servidor
// nem envia approval/clarify (server_requests._unanswerable) e o agente espera
// o timeout inteiro em silêncio.

import { api } from "./api";

export type GatewayEvent = { type: string; session_id: string; payload?: any; seq?: number };
export type ServerRequest = { id: string; method: string; params: any };

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class RpcError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
  }
}

const HEARTBEAT_MS = 15_000;
const NO_PROFILE_METHODS = new Set(["client.capabilities", "ping", "gateway.capabilities"]);

export class GatewayClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private eventHandlers = new Set<(e: GatewayEvent) => void>();
  private requestHandlers = new Set<(r: ServerRequest) => void>();
  private stateHandlers = new Set<(s: ConnState) => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readyResolve: (() => void) | null = null;
  private closedByUser = false;
  state: ConnState = "idle";

  onEvent(fn: (e: GatewayEvent) => void) { this.eventHandlers.add(fn); return () => { this.eventHandlers.delete(fn); }; }
  onRequest(fn: (r: ServerRequest) => void) { this.requestHandlers.add(fn); return () => { this.requestHandlers.delete(fn); }; }
  onState(fn: (s: ConnState) => void) { this.stateHandlers.add(fn); return () => { this.stateHandlers.delete(fn); }; }

  private setState(s: ConnState) {
    this.state = s;
    this.stateHandlers.forEach((f) => f(s));
  }

  /** Resolve a URL do WS conforme o modo de auth do servidor (/api/status.auth_required). */
  private async wsUrl(): Promise<string> {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const base = `${scheme}://${window.location.host}/api/ws`;
    const status = await api.status().catch(() => ({} as any));
    if (status?.auth_required) {
      const { ticket } = await api.wsTicket();
      return `${base}?ticket=${encodeURIComponent(ticket)}`;
    }
    const devToken = (import.meta as any).env?.VITE_SESSION_TOKEN as string | undefined;
    return devToken ? `${base}?token=${encodeURIComponent(devToken)}` : base;
  }

  private connecting: Promise<void> | null = null;

  /** Idempotente: chamadas concorrentes (StrictMode monta 2x) compartilham a mesma conexão. */
  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this._connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async _connect(): Promise<void> {
    this.closedByUser = false;
    this.setState("connecting");
    const url = await this.wsUrl();
    const ws = new WebSocket(url);
    this.ws = ws;
    const ready = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      ws.onerror = () => rej(new Error("falha ao conectar ao gateway"));
      ws.onclose = (ev) => rej(new Error(`gateway fechou a conexão (${ev.code})`));
    });
    ws.onmessage = (ev) => this.onFrame(String(ev.data));
    await ready;
    ws.onerror = null;
    ws.onclose = (ev) => this.onClose(ev.code);
    // Sem esta declaração o servidor não envia approval/clarify (ver cabeçalho).
    // Se isto falhar, aprovação/clarify NUNCA chegam — não pode ser silencioso.
    await this.call("client.capabilities", { server_requests: true }).catch((e) => {
      console.error("[gateway] client.capabilities recusado — cartões de aprovação/escolha não vão funcionar:", e?.message || e);
    });
    this.heartbeat = setInterval(() => { this.call("ping", {}).catch(() => {}); }, HEARTBEAT_MS);
    this.setState("open");
  }

  close() {
    this.closedByUser = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.ws?.close();
    this.ws = null;
    this.setState("closed");
  }

  private onClose(code: number) {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.ws = null;
    const err = new Error(`conexão com o gateway encerrada (${code})`);
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
    this.setState(this.closedByUser ? "closed" : "lost");
  }

  private onFrame(raw: string) {
    // O transporte pode coalescer vários frames por mensagem (um por linha).
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      let obj: any;
      try { obj = JSON.parse(t); } catch { continue; }
      this.dispatch(obj);
    }
  }

  private dispatch(obj: any) {
    if (obj.method === "event" && obj.params) {
      const ev = obj.params as GatewayEvent;
      if (ev.type === "gateway.ready" && this.readyResolve) { this.readyResolve(); this.readyResolve = null; }
      this.eventHandlers.forEach((f) => f(ev));
      return;
    }
    if (typeof obj.id === "string" && obj.method) {
      // Pedido do servidor ao cliente (approval / clarify / ...).
      const r: ServerRequest = { id: obj.id, method: obj.method, params: obj.params || {} };
      this.requestHandlers.forEach((f) => f(r));
      return;
    }
    if (typeof obj.id === "number") {
      const p = this.pending.get(obj.id);
      if (!p) return;
      this.pending.delete(obj.id);
      if (obj.error) p.reject(new RpcError(obj.error.code ?? -1, obj.error.message || "erro do gateway", obj.error.data));
      else p.resolve(obj.result);
    }
  }

  call<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("gateway desconectado"));
    const id = this.nextId++;
    // Dev: escopo de profile do dashboard local (VITE_PROFILE). Em produção a
    // instância tem um profile só e o campo fica ausente.
    // ARMADILHA provada: client.capabilities/ping NÃO aceitam `profile` (pydantic
    // extra=forbid -> erro 4000) e, sem capabilities aceito, o servidor nem envia
    // approval/clarify. Só injeta nos métodos que declaram o campo.
    const devProfile = (import.meta as any).env?.VITE_PROFILE as string | undefined;
    if (devProfile && !("profile" in params) && !NO_PROFILE_METHODS.has(method)) params = { ...params, profile: devProfile };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /** Responde a um pedido servidor->cliente (mesmo id string). */
  answer(requestId: string, result: Record<string, unknown>) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: requestId, result }));
  }
}

export type ConnState = "idle" | "connecting" | "open" | "lost" | "closed";

// Instância única por aba: todos os componentes compartilham a conexão.
export const gateway = new GatewayClient();

// --- Tipos dos resultados que usamos (subset do contrato) ---------------------
export interface TranscriptMessage {
  role: string;
  text?: string | null;
  timestamp?: number | null;
  row_id?: number | null;
  display_kind?: string | null;
  name?: string | null;
  [k: string]: unknown;
}
export interface SessionCreateResult {
  session_id: string;
  stored_session_id: string;
  message_count: number;
  messages: TranscriptMessage[];
  info: { model?: string; provider?: string; title?: string; running?: boolean; [k: string]: unknown };
}
export interface SessionResumeResult extends Omit<SessionCreateResult, "stored_session_id"> {
  stored_session_id?: string | null;
  running?: boolean | null;
  pending_approval?: any;
  open_requests?: ServerRequest[] | null;
}
