import type { Plugin } from "vite";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

// Backend de MENTIRA que espelha o DASHBOARD real do Hermes (tag v2026.9.21):
//   REST: /api/status, /api/auth/me, /api/auth/ws-ticket, /api/sessions,
//         /api/sessions/search, /api/sessions/{id}/messages, DELETE /api/sessions/{id},
//         /api/model/options, /api/chat/image-upload, /api/messaging/*
//   WS:   /api/ws — JSON-RPC (session.create/resume, prompt.submit, image.attach_bytes,
//         file.attach, session.interrupt, client.capabilities, ping) + eventos
//         (gateway.ready, message.start/delta/complete, tool.start/complete,
//         session.title) + pedidos servidor->cliente (approval, clarify).
// Ativado só com VITE_MOCK=1. Formas copiadas dos handlers reais — se o mock
// divergir do real, o real ganha e o mock é que está errado.
// Sem dependência: o WS é RFC 6455 mínimo em cima do servidor HTTP do Vite.

const now = Math.floor(Date.now() / 1000);
const SESSIONS: any[] = [
  { id: "20260922_174000_a1b2c3", title: "Marketing — Urban Passageiro", preview: "vamos configurar o marketing", started_at: now - 3600, last_active: now - 600, message_count: 4, source: "web", model: "anthropic/claude-sonnet-4-6", archived: false, pinned: false, is_active: false, profile: "default" },
  { id: "20260922_150000_d4e5f6", title: "Primeiros passos", preview: "o que você consegue fazer?", started_at: now - 10000, last_active: now - 9000, message_count: 3, source: "web", archived: false, pinned: false, is_active: false, profile: "default" },
  { id: "20260921_140500_g7h8i9", title: null, preview: "como troco o modelo?", started_at: now - 100000, last_active: now - 99000, message_count: 2, source: "telegram", archived: false, pinned: false, is_active: false, profile: "default" },
];
const MESSAGES: Record<string, any[]> = {
  "20260922_174000_a1b2c3": [
    { id: 1, role: "user", content: "vamos configurar o marketing", timestamp: now - 3600 },
    { id: 2, role: "assistant", content: "Ótimo! O onboarding já está em andamento — Drive conectado ✅. Próxima etapa: logo 🎨", timestamp: now - 3590 },
    { id: 3, role: "user", content: "esta é a logo horizontal preta", timestamp: now - 3000 },
    { id: 4, role: "assistant", content: "Recebi. Subi para o Drive em Hermes - Marketing/Identidade/. Agora me diga as cores da marca.", timestamp: now - 2990 },
  ],
  "20260922_150000_d4e5f6": [
    { id: 5, role: "assistant", content: "Bem-vindo ao seu painel 👋 Como posso ajudar hoje?", timestamp: now - 10000 },
    { id: 6, role: "user", content: "o que você consegue fazer?", timestamp: now - 9500 },
    { id: 7, role: "assistant", content: "Posso conversar, gerar conteúdo de marketing e conectar seus canais.", timestamp: now - 9000 },
  ],
  "20260921_140500_g7h8i9": [
    { id: 8, role: "user", content: "como troco o modelo?", timestamp: now - 100000 },
    { id: 9, role: "assistant", content: "Nas configurações (⚙), aba Modelos.", timestamp: now - 99000 },
  ],
};
const MODEL_OPTIONS = {
  providers: [
    { slug: "anthropic", name: "Anthropic", models: ["claude-opus-4-8", "claude-sonnet-4-6"], authenticated: true, is_current: true, featured_models: ["claude-sonnet-4-6"] },
    { slug: "google", name: "Google Gemini", models: ["gemini-3.6-flash"], authenticated: true, is_current: false },
    { slug: "openai", name: "OpenAI", models: ["gpt-5.3"], authenticated: false, is_current: false },
  ],
  model: "claude-sonnet-4-6",
  provider: "anthropic",
};
const ME = { user_id: "kc-1234", email: "herbert@urban.example", display_name: "Herbert (Urban)", org_id: null, provider: "self-hosted", expires_at: now + 900 };

const wa = { polls: 0, connected: false };
const tg = { polls: 0, connected: false };
const SAMPLE_QR = "2@mockWhatsAppPairingPayload/ExemploParaDesenvolvimentoVisual==,AbCdEf123==,XyZ==";

function send(res: any, body: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

// --- WebSocket mínimo (RFC 6455) --------------------------------------------
function wsAccept(key: string) {
  return createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}
function wsFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header: Buffer;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}
/** Decodifica frames completos do buffer; devolve textos e o resto não consumido. */
function wsParse(buf: Buffer): { texts: string[]; rest: Buffer; close: boolean } {
  const texts: string[] = [];
  let off = 0;
  let close = false;
  while (buf.length - off >= 2) {
    const b0 = buf[off], b1 = buf[off + 1];
    const op = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) { if (buf.length < p + 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length < p + 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (buf.length < p + len) break;
    const data = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    off = p + len;
    if (op === 0x8) { close = true; break; }
    if (op === 0x1) texts.push(data.toString("utf8"));
    // 0x9 ping / 0xA pong / 0x2 binário: ignorados no mock
  }
  return { texts, rest: buf.subarray(off), close };
}

// --- Estado do gateway simulado ---------------------------------------------
type Live = { runtime: string; stored: string; title: string; attached: string[]; running: boolean; timers: ReturnType<typeof setTimeout>[] };
let seq = 0;

export function mockApi(): Plugin {
  return {
    name: "hermes-mock-dashboard",
    configureServer(server) {
      // ---------- WS /api/ws ----------
      server.httpServer?.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const url = (req.url || "").split("?")[0];
        if (url !== "/api/ws") return; // deixa o HMR do Vite cuidar do resto
        const key = req.headers["sec-websocket-key"] as string;
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`);
        let buf: Buffer = head?.length ? Buffer.from(head) : Buffer.alloc(0);
        const live = new Map<string, Live>();
        const write = (obj: unknown) => { if (!socket.destroyed) socket.write(wsFrame(JSON.stringify(obj))); };
        const emit = (type: string, sid: string, payload?: unknown) =>
          write({ jsonrpc: "2.0", method: "event", params: { type, session_id: sid, ...(payload !== undefined ? { payload } : {}), seq: ++seq } });
        const ok = (id: number, result: unknown) => write({ jsonrpc: "2.0", id, result });
        const err = (id: number, code: number, message: string) => write({ jsonrpc: "2.0", id, error: { code, message } });

        emit("gateway.ready", "", { skin: {}, change_events: true, replay_epoch: "mock", heartbeat: true });

        function info(l: Live) {
          return { model: MODEL_OPTIONS.model, provider: MODEL_OPTIONS.provider, title: l.title, running: l.running, stored_session_id: l.stored, cwd: "/opt/data", version: "0.21.4" };
        }
        function transcript(stored: string) {
          return (MESSAGES[stored] || []).map((m) => ({ role: m.role, text: m.content, timestamp: m.timestamp, row_id: m.id }));
        }
        function runTurn(l: Live, text: string) {
          l.running = true;
          const sid = l.runtime;
          const t = text.toLowerCase();
          const later = (ms: number, fn: () => void) => { l.timers.push(setTimeout(fn, ms)); };
          const attachedNote = l.attached.length ? `Recebi ${l.attached.length} anexo(s): ${l.attached.join(", ")}. ` : "";
          l.attached = [];
          // Aprovação: o agente quer rodar um comando "perigoso".
          if (/apag|delet|rm -rf|aprov/i.test(t)) {
            later(300, () => emit("tool.start", sid, { tool_id: "t1", name: "terminal", preview: "rm -rf /opt/data/tmp" }));
            later(500, () => { openReq.set("srq-mock0001", l); write({ jsonrpc: "2.0", id: "srq-mock0001", method: "approval", params: { session_id: sid, request_id: "apr-1", command: "rm -rf /opt/data/tmp", description: "remover diretório temporário", choices: ["once", "session", "always", "deny"], tool_name: "terminal" } }); });
            return;
          }
          // Clarify: o agente pergunta com opções (par da enquete WhatsApp).
          if (/qual|escolh|opç|variaç/i.test(t)) {
            later(400, () => { openReq.set("srq-mock0002", l); write({ jsonrpc: "2.0", id: "srq-mock0002", method: "clarify", params: { session_id: sid, question: "Qual variação de arte publicar hoje?", choices: ["Variação 1 — fundo escuro", "Variação 2 — fundo claro", "Depois"] } }); });
            return;
          }
          const reply = `${attachedNote}Você disse: "${text}". Esta é uma resposta em streaming do modo mock, palavra por palavra, para validar a renderização.`;
          const words = reply.split(" ");
          later(200, () => emit("message.start", sid, {}));
          words.forEach((w, i) => later(300 + i * 60, () => emit("message.delta", sid, { text: (i ? " " : "") + w })));
          later(300 + words.length * 60 + 100, () => {
            l.running = false;
            emit("message.complete", sid, { text: reply, status: "complete", usage: { input_tokens: 12, output_tokens: words.length } });
            if (!l.title) { l.title = text.slice(0, 40); emit("session.title", sid, { session_id: sid, title: l.title });
              const row = SESSIONS.find((s) => s.id === l.stored); if (row) row.title = l.title; }
            emit("sessions.changed", "", {});
          });
          MESSAGES[l.stored] = [...(MESSAGES[l.stored] || []), { id: Date.now(), role: "user", content: text, timestamp: Math.floor(Date.now() / 1000) }, { id: Date.now() + 1, role: "assistant", content: reply, timestamp: Math.floor(Date.now() / 1000) + 1 }];
        }
        function finishApproval(l: Live, choice: string) {
          const sid = l.runtime;
          emit("tool.complete", sid, { tool_id: "t1", name: "terminal", summary: choice === "deny" ? "negado pelo usuário" : "ok" });
          setTimeout(() => { emit("message.start", sid, {}); emit("message.delta", sid, { text: choice === "deny" ? "Entendido, não executei." : "Feito, diretório removido." }); l.running = false; emit("message.complete", sid, { text: choice === "deny" ? "Entendido, não executei." : "Feito, diretório removido.", status: "complete" }); }, 300);
        }
        function finishClarify(l: Live, answer: string) {
          const sid = l.runtime;
          setTimeout(() => { emit("message.start", sid, {}); const txt = `Perfeito — segui com **${answer || "(pulado)"}**. Publico hoje às 7h.`; emit("message.delta", sid, { text: txt }); l.running = false; emit("message.complete", sid, { text: txt, status: "complete" }); }, 300);
        }

        const openReq = new Map<string, Live>();
        function handle(obj: any) {
          // Resposta a pedido servidor->cliente
          if (typeof obj.id === "string" && obj.id.startsWith("srq-") && obj.result !== undefined) {
            const l = openReq.get(obj.id);
            openReq.delete(obj.id);
            if (!l) return;
            if (obj.id === "srq-mock0001") finishApproval(l, String(obj.result.choice || "deny"));
            if (obj.id === "srq-mock0002") finishClarify(l, String(obj.result.answer || ""));
            return;
          }
          const { id, method, params = {} } = obj;
          switch (method) {
            case "ping": return ok(id, {});
            case "client.capabilities": return ok(id, { server_requests: ["approval", "clarify", "secret", "sudo", "vault.code"] });
            case "session.create": {
              const stored = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15) + "_" + Math.random().toString(36).slice(2, 8);
              const runtime = "rt-" + stored;
              const l: Live = { runtime, stored, title: params.title || "", attached: [], running: false, timers: [] };
              live.set(runtime, l);
              SESSIONS.unshift({ id: stored, title: l.title || null, preview: "", started_at: Math.floor(Date.now() / 1000), last_active: Math.floor(Date.now() / 1000), message_count: 0, source: "web", archived: false, pinned: false, is_active: true, profile: "default" });
              return ok(id, { session_id: runtime, stored_session_id: stored, message_count: 0, messages: [], info: info(l) });
            }
            case "session.resume": {
              const stored = String(params.session_id || "");
              const row = SESSIONS.find((s) => s.id === stored);
              if (!row) return err(id, 5001, "session not found");
              const runtime = "rt-" + stored;
              const l: Live = live.get(runtime) || { runtime, stored, title: row.title || "", attached: [], running: false, timers: [] };
              live.set(runtime, l);
              const msgs = transcript(stored);
              return ok(id, { session_id: runtime, stored_session_id: stored, message_count: msgs.length, messages: msgs, info: info(l), running: l.running, open_requests: [] });
            }
            case "prompt.submit": {
              const l = live.get(String(params.session_id));
              if (!l) return err(id, 5002, "unknown session");
              ok(id, { status: "streaming" });
              runTurn(l, String(params.text || ""));
              return;
            }
            case "image.attach_bytes": {
              const l = live.get(String(params.session_id));
              if (!l) return err(id, 5002, "unknown session");
              const bytes = Math.floor(String(params.content_base64 || params.data || "").length * 0.75);
              l.attached.push(params.filename || "imagem");
              return ok(id, { attached: true, name: params.filename || "image.png", width: 0, height: 0, bytes, count: l.attached.length });
            }
            case "file.attach": {
              const l = live.get(String(params.session_id));
              if (!l) return err(id, 5002, "unknown session");
              l.attached.push(params.name || "arquivo");
              return ok(id, { attached: true, uploaded: true, name: params.name || "file", path: "/opt/data/uploads/" + (params.name || "file"), ref_path: "uploads/" + (params.name || "file"), ref_text: "@file:uploads/" + (params.name || "file") });
            }
            case "session.interrupt": {
              const l = live.get(String(params.session_id));
              if (l) { l.timers.forEach(clearTimeout); l.timers = []; l.running = false; emit("message.complete", l.runtime, { text: "", status: "interrupted", partial: true }); }
              return ok(id, { interrupted: !!l });
            }
            case "session.close": return ok(id, { closed: live.delete(String(params.session_id)) });
            case "session.title": { const l = live.get(String(params.session_id)); if (l && typeof params.title === "string") l.title = params.title; return ok(id, { title: l?.title || "" }); }
            default: return err(id, -32601, `Method not found: ${method}`);
          }
        }

        socket.on("data", (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          const { texts, rest, close } = wsParse(buf);
          buf = Buffer.from(rest);
          for (const t of texts) { try { handle(JSON.parse(t)); } catch { /* frame inválido */ } }
          if (close) socket.end();
        });
        socket.on("error", () => {});
      });

      // ---------- REST ----------
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const qs = new URLSearchParams((req.url || "").split("?")[1] || "");
        if (!url.startsWith("/api") && !url.startsWith("/auth")) return next();

        if (url === "/api/status") return send(res, { version: "0.21.4", release_date: "2026.9.21", auth_required: false, gateway_running: true, gateway_state: "running" });
        if (url === "/api/auth/me") return send(res, ME);
        if (url === "/api/auth/ws-ticket" && req.method === "POST") return send(res, { ticket: "mock-ticket", ttl_seconds: 30 });
        if (url === "/auth/logout" && req.method === "POST") { res.statusCode = 302; res.setHeader("Location", "/login"); return res.end(); }
        if (url === "/login") return send(res, { mock: "tela de login (no real é o Keycloak)" });

        if (url === "/api/sessions" && req.method === "GET") {
          const excl = (qs.get("exclude_sources") || "").split(",").filter(Boolean);
          const rows = SESSIONS.filter((s) => !excl.includes(s.source));
          const limit = Number(qs.get("limit") || 20), offset = Number(qs.get("offset") || 0);
          return send(res, { sessions: rows.slice(offset, offset + limit), total: rows.length, limit, offset });
        }
        if (url === "/api/sessions/search") {
          const q = (qs.get("q") || "").toLowerCase();
          if (!q.trim()) return send(res, { results: [] });
          const results = SESSIONS.filter((s) => (s.title || "").toLowerCase().includes(q) || (MESSAGES[s.id] || []).some((m) => String(m.content).toLowerCase().includes(q)))
            .map((s) => ({ ...s, snippet: (MESSAGES[s.id] || []).find((m) => String(m.content).toLowerCase().includes(q))?.content || s.preview }));
          return send(res, { results });
        }
        let mm = url.match(/^\/api\/sessions\/([^/]+)\/messages$/);
        if (mm) {
          const sid = decodeURIComponent(mm[1]);
          if (!SESSIONS.some((s) => s.id === sid)) return send(res, { detail: "Session not found" }, 404);
          const messages = MESSAGES[sid] || [];
          return send(res, { session_id: sid, profile: "default", messages, pagination: { limit: 500, offset: 0, order: "latest", returned: messages.length } });
        }
        let dm = url.match(/^\/api\/sessions\/([^/]+)$/);
        if (dm && req.method === "DELETE") {
          const sid = decodeURIComponent(dm[1]);
          const i = SESSIONS.findIndex((s) => s.id === sid);
          if (i < 0) return send(res, { detail: "Session not found" }, 404);
          SESSIONS.splice(i, 1); delete MESSAGES[sid];
          return send(res, { ok: true, deleted: sid });
        }
        if (url === "/api/model/options") return send(res, MODEL_OPTIONS);
        if (url === "/api/chat/image-upload" && req.method === "POST") {
          const b = await readBody(req);
          if (!String(b.data_url || "").startsWith("data:image/")) return send(res, { detail: "Unsupported image type" }, 400);
          const name = `dashboard_${Date.now()}_${b.filename || "pasted-image.png"}`;
          return send(res, { ok: true, path: "/opt/data/images/" + name, name, bytes: Math.floor(String(b.data_url).length * 0.75), mime_type: "image/png" });
        }

        // --- Mensageria (formas já alinhadas ao upstream) ---
        if (url === "/api/messaging/platforms") return send(res, { whatsapp: { enabled: wa.connected, connected: wa.connected }, telegram: { enabled: tg.connected, connected: tg.connected } });
        if (url === "/api/messaging/whatsapp/onboarding/start" && req.method === "POST") { wa.polls = 0; wa.connected = false; return send(res, { pairing_id: "wa_mock_1" }); }
        let wm = url.match(/^\/api\/messaging\/whatsapp\/onboarding\/([^/]+)$/);
        if (wm) { wa.polls += 1; if (wa.polls >= 3) { wa.connected = true; return send(res, { pairing_id: wm[1], status: "connected", account_phone: "+55 65 99999-0000" }); } return send(res, { pairing_id: wm[1], status: "awaiting_qr", qr_payload: SAMPLE_QR }); }
        if (/^\/api\/messaging\/whatsapp\/onboarding\/[^/]+\/apply$/.test(url) && req.method === "POST") return send(res, { ok: true, needs_restart: false });
        if (url === "/api/messaging/telegram/onboarding/start" && req.method === "POST") { tg.polls = 0; tg.connected = false; return send(res, { pairing_id: "tg_mock_1", deep_link: "https://t.me/BotFather?start=mock", qr_payload: "https://t.me/BotFather?start=mock", suggested_username: "urban_bot" }); }
        let tm = url.match(/^\/api\/messaging\/telegram\/onboarding\/([^/]+)$/);
        if (tm) { tg.polls += 1; if (tg.polls >= 3) { tg.connected = true; return send(res, { status: "connected", username: "@urban_bot" }); } return send(res, { status: "pending" }); }
        if (/^\/api\/messaging\/telegram\/onboarding\/[^/]+\/apply$/.test(url) && req.method === "POST") return send(res, { ok: true, needs_restart: false });

        // Igual ao real: rota /api desconhecida NÃO vira HTML da SPA.
        return send(res, { detail: "Not Found", url }, 404);
      });
    },
  };
}
