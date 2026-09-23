var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { createHash } from "node:crypto";
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
var now = Math.floor(Date.now() / 1000);
var SESSIONS = [
    { id: "20260922_174000_a1b2c3", title: "Marketing — Urban Passageiro", preview: "vamos configurar o marketing", started_at: now - 3600, last_active: now - 600, message_count: 4, source: "web", model: "anthropic/claude-sonnet-4-6", archived: false, pinned: false, is_active: false, profile: "default" },
    { id: "20260922_150000_d4e5f6", title: "Primeiros passos", preview: "o que você consegue fazer?", started_at: now - 10000, last_active: now - 9000, message_count: 3, source: "web", archived: false, pinned: false, is_active: false, profile: "default" },
    { id: "20260921_140500_g7h8i9", title: null, preview: "como troco o modelo?", started_at: now - 100000, last_active: now - 99000, message_count: 2, source: "telegram", archived: false, pinned: false, is_active: false, profile: "default" },
];
var MESSAGES = {
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
var MODEL_OPTIONS = {
    providers: [
        { slug: "anthropic", name: "Anthropic", models: ["claude-opus-4-8", "claude-sonnet-4-6"], authenticated: true, is_current: true, featured_models: ["claude-sonnet-4-6"] },
        { slug: "google", name: "Google Gemini", models: ["gemini-3.6-flash"], authenticated: true, is_current: false },
        { slug: "openai", name: "OpenAI", models: ["gpt-5.3"], authenticated: false, is_current: false },
    ],
    model: "claude-sonnet-4-6",
    provider: "anthropic",
};
var ME = { user_id: "kc-1234", email: "herbert@urban.example", display_name: "Herbert (Urban)", org_id: null, provider: "self-hosted", expires_at: now + 900 };
var wa = { polls: 0, connected: false, mode: "self-chat" };
var tg = { polls: 0, connected: false };
// Estado persistente dos canais (o que GET /api/messaging/platforms devolve).
var waP = { enabled: false, configured: false, state: "disabled", restartAt: 0, mode: "" };
var tgP = { enabled: false, configured: false, state: "disabled", restartAt: 0 };
var SAMPLE_QR = "2@mockWhatsAppPairingPayload/ExemploParaDesenvolvimentoVisual==,AbCdEf123==,XyZ==";
function send(res, body, status) {
    if (status === void 0) { status = 200; }
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
}
function readBody(req) {
    return new Promise(function (resolve) {
        var raw = "";
        req.on("data", function (c) { raw += c; });
        req.on("end", function () { try {
            resolve(raw ? JSON.parse(raw) : {});
        }
        catch (_a) {
            resolve({});
        } });
    });
}
// --- WebSocket mínimo (RFC 6455) --------------------------------------------
function wsAccept(key) {
    return createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}
function wsFrame(text) {
    var payload = Buffer.from(text, "utf8");
    var len = payload.length;
    var header;
    if (len < 126)
        header = Buffer.from([0x81, len]);
    else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    }
    else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}
/** Decodifica frames completos do buffer; devolve textos e o resto não consumido. */
function wsParse(buf) {
    var texts = [];
    var off = 0;
    var close = false;
    while (buf.length - off >= 2) {
        var b0 = buf[off], b1 = buf[off + 1];
        var op = b0 & 0x0f;
        var masked = (b1 & 0x80) !== 0;
        var len = b1 & 0x7f;
        var p = off + 2;
        if (len === 126) {
            if (buf.length < p + 2)
                break;
            len = buf.readUInt16BE(p);
            p += 2;
        }
        else if (len === 127) {
            if (buf.length < p + 8)
                break;
            len = Number(buf.readBigUInt64BE(p));
            p += 8;
        }
        var mask = masked ? buf.subarray(p, p + 4) : null;
        if (masked)
            p += 4;
        if (buf.length < p + len)
            break;
        var data = Buffer.from(buf.subarray(p, p + len));
        if (mask)
            for (var i = 0; i < data.length; i++)
                data[i] ^= mask[i & 3];
        off = p + len;
        if (op === 0x8) {
            close = true;
            break;
        }
        if (op === 0x1)
            texts.push(data.toString("utf8"));
        // 0x9 ping / 0xA pong / 0x2 binário: ignorados no mock
    }
    return { texts: texts, rest: buf.subarray(off), close: close };
}
var seq = 0;
export function mockApi() {
    return {
        name: "hermes-mock-dashboard",
        configureServer: function (server) {
            var _this = this;
            var _a;
            // ---------- WS /api/ws ----------
            (_a = server.httpServer) === null || _a === void 0 ? void 0 : _a.on("upgrade", function (req, socket, head) {
                var url = (req.url || "").split("?")[0];
                if (url !== "/api/ws")
                    return; // deixa o HMR do Vite cuidar do resto
                var key = req.headers["sec-websocket-key"];
                socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ".concat(wsAccept(key), "\r\n\r\n"));
                var buf = (head === null || head === void 0 ? void 0 : head.length) ? Buffer.from(head) : Buffer.alloc(0);
                var live = new Map();
                var write = function (obj) { if (!socket.destroyed)
                    socket.write(wsFrame(JSON.stringify(obj))); };
                var emit = function (type, sid, payload) {
                    return write({ jsonrpc: "2.0", method: "event", params: __assign(__assign({ type: type, session_id: sid }, (payload !== undefined ? { payload: payload } : {})), { seq: ++seq }) });
                };
                var ok = function (id, result) { return write({ jsonrpc: "2.0", id: id, result: result }); };
                var err = function (id, code, message) { return write({ jsonrpc: "2.0", id: id, error: { code: code, message: message } }); };
                emit("gateway.ready", "", { skin: {}, change_events: true, replay_epoch: "mock", heartbeat: true });
                function info(l) {
                    return { model: MODEL_OPTIONS.model, provider: MODEL_OPTIONS.provider, title: l.title, running: l.running, stored_session_id: l.stored, cwd: "/opt/data", version: "0.21.4" };
                }
                function transcript(stored) {
                    return (MESSAGES[stored] || []).map(function (m) { return ({ role: m.role, text: m.content, timestamp: m.timestamp, row_id: m.id }); });
                }
                function runTurn(l, text) {
                    l.running = true;
                    var sid = l.runtime;
                    var t = text.toLowerCase();
                    var later = function (ms, fn) { l.timers.push(setTimeout(fn, ms)); };
                    var attachedNote = l.attached.length ? "Recebi ".concat(l.attached.length, " anexo(s): ").concat(l.attached.join(", "), ". ") : "";
                    l.attached = [];
                    // Aprovação: o agente quer rodar um comando "perigoso".
                    if (/apag|delet|rm -rf|aprov/i.test(t)) {
                        later(300, function () { return emit("tool.start", sid, { tool_id: "t1", name: "terminal", preview: "rm -rf /opt/data/tmp" }); });
                        later(500, function () { openReq.set("srq-mock0001", l); write({ jsonrpc: "2.0", id: "srq-mock0001", method: "approval", params: { session_id: sid, request_id: "apr-1", command: "rm -rf /opt/data/tmp", description: "remover diretório temporário", choices: ["once", "session", "always", "deny"], tool_name: "terminal" } }); });
                        return;
                    }
                    // Clarify: o agente pergunta com opções (par da enquete WhatsApp).
                    if (/qual|escolh|opç|variaç/i.test(t)) {
                        later(400, function () { openReq.set("srq-mock0002", l); write({ jsonrpc: "2.0", id: "srq-mock0002", method: "clarify", params: { session_id: sid, question: "Qual variação de arte publicar hoje?", choices: ["Variação 1 — fundo escuro", "Variação 2 — fundo claro", "Depois"] } }); });
                        return;
                    }
                    var reply = "".concat(attachedNote, "Voc\u00EA disse: \"").concat(text, "\". Esta \u00E9 uma resposta em streaming do modo mock, palavra por palavra, para validar a renderiza\u00E7\u00E3o.");
                    var words = reply.split(" ");
                    later(200, function () { return emit("message.start", sid, {}); });
                    words.forEach(function (w, i) { return later(300 + i * 60, function () { return emit("message.delta", sid, { text: (i ? " " : "") + w }); }); });
                    later(300 + words.length * 60 + 100, function () {
                        l.running = false;
                        emit("message.complete", sid, { text: reply, status: "complete", usage: { input_tokens: 12, output_tokens: words.length } });
                        if (!l.title) {
                            l.title = text.slice(0, 40);
                            emit("session.title", sid, { session_id: sid, title: l.title });
                            var row = SESSIONS.find(function (s) { return s.id === l.stored; });
                            if (row)
                                row.title = l.title;
                        }
                        emit("sessions.changed", "", {});
                    });
                    MESSAGES[l.stored] = __spreadArray(__spreadArray([], (MESSAGES[l.stored] || []), true), [{ id: Date.now(), role: "user", content: text, timestamp: Math.floor(Date.now() / 1000) }, { id: Date.now() + 1, role: "assistant", content: reply, timestamp: Math.floor(Date.now() / 1000) + 1 }], false);
                }
                function finishApproval(l, choice) {
                    var sid = l.runtime;
                    emit("tool.complete", sid, { tool_id: "t1", name: "terminal", summary: choice === "deny" ? "negado pelo usuário" : "ok" });
                    setTimeout(function () { emit("message.start", sid, {}); emit("message.delta", sid, { text: choice === "deny" ? "Entendido, não executei." : "Feito, diretório removido." }); l.running = false; emit("message.complete", sid, { text: choice === "deny" ? "Entendido, não executei." : "Feito, diretório removido.", status: "complete" }); }, 300);
                }
                function finishClarify(l, answer) {
                    var sid = l.runtime;
                    setTimeout(function () { emit("message.start", sid, {}); var txt = "Perfeito \u2014 segui com **".concat(answer || "(pulado)", "**. Publico hoje \u00E0s 7h."); emit("message.delta", sid, { text: txt }); l.running = false; emit("message.complete", sid, { text: txt, status: "complete" }); }, 300);
                }
                var openReq = new Map();
                function handle(obj) {
                    // Resposta a pedido servidor->cliente
                    if (typeof obj.id === "string" && obj.id.startsWith("srq-") && obj.result !== undefined) {
                        var l = openReq.get(obj.id);
                        openReq.delete(obj.id);
                        if (!l)
                            return;
                        if (obj.id === "srq-mock0001")
                            finishApproval(l, String(obj.result.choice || "deny"));
                        if (obj.id === "srq-mock0002")
                            finishClarify(l, String(obj.result.answer || ""));
                        return;
                    }
                    var id = obj.id, method = obj.method, _a = obj.params, params = _a === void 0 ? {} : _a;
                    switch (method) {
                        case "ping": return ok(id, {});
                        case "client.capabilities": return ok(id, { server_requests: ["approval", "clarify", "secret", "sudo", "vault.code"] });
                        case "session.create": {
                            var stored = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15) + "_" + Math.random().toString(36).slice(2, 8);
                            var runtime = "rt-" + stored;
                            var l = { runtime: runtime, stored: stored, title: params.title || "", attached: [], running: false, timers: [] };
                            live.set(runtime, l);
                            SESSIONS.unshift({ id: stored, title: l.title || null, preview: "", started_at: Math.floor(Date.now() / 1000), last_active: Math.floor(Date.now() / 1000), message_count: 0, source: "web", archived: false, pinned: false, is_active: true, profile: "default" });
                            return ok(id, { session_id: runtime, stored_session_id: stored, message_count: 0, messages: [], info: info(l) });
                        }
                        case "session.resume": {
                            var stored_1 = String(params.session_id || "");
                            var row = SESSIONS.find(function (s) { return s.id === stored_1; });
                            if (!row)
                                return err(id, 5001, "session not found");
                            var runtime = "rt-" + stored_1;
                            var l = live.get(runtime) || { runtime: runtime, stored: stored_1, title: row.title || "", attached: [], running: false, timers: [] };
                            live.set(runtime, l);
                            var msgs = transcript(stored_1);
                            return ok(id, { session_id: runtime, stored_session_id: stored_1, message_count: msgs.length, messages: msgs, info: info(l), running: l.running, open_requests: [] });
                        }
                        case "prompt.submit": {
                            var l = live.get(String(params.session_id));
                            if (!l)
                                return err(id, 5002, "unknown session");
                            ok(id, { status: "streaming" });
                            runTurn(l, String(params.text || ""));
                            return;
                        }
                        case "image.attach_bytes": {
                            var l = live.get(String(params.session_id));
                            if (!l)
                                return err(id, 5002, "unknown session");
                            var bytes = Math.floor(String(params.content_base64 || params.data || "").length * 0.75);
                            l.attached.push(params.filename || "imagem");
                            return ok(id, { attached: true, name: params.filename || "image.png", width: 0, height: 0, bytes: bytes, count: l.attached.length });
                        }
                        case "file.attach": {
                            var l = live.get(String(params.session_id));
                            if (!l)
                                return err(id, 5002, "unknown session");
                            l.attached.push(params.name || "arquivo");
                            return ok(id, { attached: true, uploaded: true, name: params.name || "file", path: "/opt/data/uploads/" + (params.name || "file"), ref_path: "uploads/" + (params.name || "file"), ref_text: "@file:uploads/" + (params.name || "file") });
                        }
                        case "session.interrupt": {
                            var l = live.get(String(params.session_id));
                            if (l) {
                                l.timers.forEach(clearTimeout);
                                l.timers = [];
                                l.running = false;
                                emit("message.complete", l.runtime, { text: "", status: "interrupted", partial: true });
                            }
                            return ok(id, { interrupted: !!l });
                        }
                        case "session.close": return ok(id, { closed: live.delete(String(params.session_id)) });
                        case "session.title": {
                            var l = live.get(String(params.session_id));
                            if (l && typeof params.title === "string")
                                l.title = params.title;
                            return ok(id, { title: (l === null || l === void 0 ? void 0 : l.title) || "" });
                        }
                        default: return err(id, -32601, "Method not found: ".concat(method));
                    }
                }
                socket.on("data", function (chunk) {
                    buf = Buffer.concat([buf, chunk]);
                    var _a = wsParse(buf), texts = _a.texts, rest = _a.rest, close = _a.close;
                    buf = Buffer.from(rest);
                    for (var _i = 0, texts_1 = texts; _i < texts_1.length; _i++) {
                        var t = texts_1[_i];
                        try {
                            handle(JSON.parse(t));
                        }
                        catch ( /* frame inválido */_b) { /* frame inválido */ }
                    }
                    if (close)
                        socket.end();
                });
                socket.on("error", function () { });
            });
            // ---------- REST ----------
            server.middlewares.use(function (req, res, next) { return __awaiter(_this, void 0, void 0, function () {
                var url, qs, excl_1, rows, limit, offset, q_1, results, mm, sid_1, messages, dm, sid_2, i, b, name_1, platRow, pm, b, st, b, wm, b, tm, b, ids;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            url = (req.url || "").split("?")[0];
                            qs = new URLSearchParams((req.url || "").split("?")[1] || "");
                            if (!url.startsWith("/api") && !url.startsWith("/auth"))
                                return [2 /*return*/, next()];
                            if (url === "/api/status")
                                return [2 /*return*/, send(res, { version: "0.21.4", release_date: "2026.9.21", auth_required: false, gateway_running: true, gateway_state: "running" })];
                            if (url === "/api/auth/me")
                                return [2 /*return*/, send(res, ME)];
                            if (url === "/api/auth/ws-ticket" && req.method === "POST")
                                return [2 /*return*/, send(res, { ticket: "mock-ticket", ttl_seconds: 30 })];
                            if (url === "/auth/logout" && req.method === "POST") {
                                res.statusCode = 302;
                                res.setHeader("Location", "/login");
                                return [2 /*return*/, res.end()];
                            }
                            if (url === "/login")
                                return [2 /*return*/, send(res, { mock: "tela de login (no real é o Keycloak)" })];
                            if (url === "/api/sessions" && req.method === "GET") {
                                excl_1 = (qs.get("exclude_sources") || "").split(",").filter(Boolean);
                                rows = SESSIONS.filter(function (s) { return !excl_1.includes(s.source); });
                                limit = Number(qs.get("limit") || 20), offset = Number(qs.get("offset") || 0);
                                return [2 /*return*/, send(res, { sessions: rows.slice(offset, offset + limit), total: rows.length, limit: limit, offset: offset })];
                            }
                            if (url === "/api/sessions/search") {
                                q_1 = (qs.get("q") || "").toLowerCase();
                                if (!q_1.trim())
                                    return [2 /*return*/, send(res, { results: [] })];
                                results = SESSIONS.filter(function (s) { return (s.title || "").toLowerCase().includes(q_1) || (MESSAGES[s.id] || []).some(function (m) { return String(m.content).toLowerCase().includes(q_1); }); })
                                    .map(function (s) { var _a; return (__assign(__assign({}, s), { snippet: ((_a = (MESSAGES[s.id] || []).find(function (m) { return String(m.content).toLowerCase().includes(q_1); })) === null || _a === void 0 ? void 0 : _a.content) || s.preview })); });
                                return [2 /*return*/, send(res, { results: results })];
                            }
                            mm = url.match(/^\/api\/sessions\/([^/]+)\/messages$/);
                            if (mm) {
                                sid_1 = decodeURIComponent(mm[1]);
                                if (!SESSIONS.some(function (s) { return s.id === sid_1; }))
                                    return [2 /*return*/, send(res, { detail: "Session not found" }, 404)];
                                messages = MESSAGES[sid_1] || [];
                                return [2 /*return*/, send(res, { session_id: sid_1, profile: "default", messages: messages, pagination: { limit: 500, offset: 0, order: "latest", returned: messages.length } })];
                            }
                            dm = url.match(/^\/api\/sessions\/([^/]+)$/);
                            if (dm && req.method === "DELETE") {
                                sid_2 = decodeURIComponent(dm[1]);
                                i = SESSIONS.findIndex(function (s) { return s.id === sid_2; });
                                if (i < 0)
                                    return [2 /*return*/, send(res, { detail: "Session not found" }, 404)];
                                SESSIONS.splice(i, 1);
                                delete MESSAGES[sid_2];
                                return [2 /*return*/, send(res, { ok: true, deleted: sid_2 })];
                            }
                            if (url === "/api/model/options")
                                return [2 /*return*/, send(res, MODEL_OPTIONS)];
                            if (!(url === "/api/chat/image-upload" && req.method === "POST")) return [3 /*break*/, 2];
                            return [4 /*yield*/, readBody(req)];
                        case 1:
                            b = _a.sent();
                            if (!String(b.data_url || "").startsWith("data:image/"))
                                return [2 /*return*/, send(res, { detail: "Unsupported image type" }, 400)];
                            name_1 = "dashboard_".concat(Date.now(), "_").concat(b.filename || "pasted-image.png");
                            return [2 /*return*/, send(res, { ok: true, path: "/opt/data/images/" + name_1, name: name_1, bytes: Math.floor(String(b.data_url).length * 0.75), mime_type: "image/png" })];
                        case 2:
                            platRow = function (id, name, st) {
                                // Simula o reinício: por 6 s após o apply, o gateway "some" e o canal fica pending_restart.
                                var restarting = st.restartAt && Date.now() - st.restartAt < 6000;
                                var state = !st.enabled ? "disabled" : !st.configured ? "not_configured" : restarting ? "pending_restart" : st.state;
                                var row = { id: id, name: name, description: "", docs_url: "", enabled: st.enabled, configured: st.configured, gateway_running: !restarting, state: state, error_code: null, error_message: null, updated_at: null, home_channel: null, env_vars: [], ingress_url: null };
                                if (id === "whatsapp")
                                    row.whatsapp_setup = { mode: st.mode || "", allowed_users_set: st.mode === "self-chat", home_channel_set: false };
                                return row;
                            };
                            if (url === "/api/messaging/platforms")
                                return [2 /*return*/, send(res, { env_path: "/opt/data/.env", gateway_start_command: "hermes gateway start", platforms: [platRow("telegram", "Telegram", tgP), platRow("whatsapp", "WhatsApp", waP)] })];
                            pm = url.match(/^\/api\/messaging\/platforms\/([^/]+)$/);
                            if (!(pm && req.method === "PUT")) return [3 /*break*/, 4];
                            return [4 /*yield*/, readBody(req)];
                        case 3:
                            b = _a.sent();
                            st = pm[1] === "whatsapp" ? waP : tgP;
                            if (typeof b.enabled === "boolean")
                                st.enabled = b.enabled;
                            if (!st.enabled) {
                                st.state = "disabled";
                            }
                            return [2 /*return*/, send(res, platRow(pm[1], pm[1], st))];
                        case 4:
                            if (!(url === "/api/messaging/whatsapp/onboarding/start" && req.method === "POST")) return [3 /*break*/, 6];
                            return [4 /*yield*/, readBody(req)];
                        case 5:
                            b = _a.sent();
                            wa.polls = 0;
                            wa.connected = false;
                            wa.mode = b.mode === "self-chat" ? "self-chat" : "bot";
                            return [2 /*return*/, send(res, { pairing_id: "wa_mock_1", status: "starting", mode: wa.mode })];
                        case 6:
                            wm = url.match(/^\/api\/messaging\/whatsapp\/onboarding\/([^/]+)$/);
                            if (wm && req.method === "DELETE") {
                                wa.connected = false;
                                return [2 /*return*/, send(res, { ok: true })];
                            }
                            if (wm) {
                                wa.polls += 1;
                                if (wa.polls >= 3) {
                                    wa.connected = true;
                                    return [2 /*return*/, send(res, { pairing_id: wm[1], status: "connected", account_phone: "+55 65 99999-0000", mode: wa.mode })];
                                }
                                return [2 /*return*/, send(res, { pairing_id: wm[1], status: "awaiting_qr", qr_payload: SAMPLE_QR, mode: wa.mode })];
                            }
                            if (!(/^\/api\/messaging\/whatsapp\/onboarding\/[^/]+\/apply$/.test(url) && req.method === "POST")) return [3 /*break*/, 8];
                            if (!wa.connected)
                                return [2 /*return*/, send(res, { detail: "WhatsApp setup is not connected yet." }, 409)];
                            return [4 /*yield*/, readBody(req)];
                        case 7:
                            b = _a.sent();
                            waP.enabled = true;
                            waP.configured = true;
                            waP.state = "connected";
                            waP.mode = b.mode || wa.mode;
                            waP.restartAt = Date.now();
                            return [2 /*return*/, send(res, { ok: true, platform: "whatsapp", needs_restart: false, restart_started: true, restart_action: "gateway-restart", restart_pid: 4242 })];
                        case 8:
                            // Telegram
                            if (url === "/api/messaging/telegram/onboarding/start" && req.method === "POST") {
                                tg.polls = 0;
                                tg.connected = false;
                                return [2 /*return*/, send(res, { pairing_id: "tg_mock_1", deep_link: "https://t.me/BotFather?start=mock", qr_payload: "https://t.me/BotFather?start=mock", suggested_username: "urban_bot", expires_at: new Date(Date.now() + 600000).toISOString() })];
                            }
                            tm = url.match(/^\/api\/messaging\/telegram\/onboarding\/([^/]+)$/);
                            if (tm && req.method === "DELETE") {
                                tg.connected = false;
                                return [2 /*return*/, send(res, { ok: true })];
                            }
                            if (tm) {
                                tg.polls += 1;
                                if (tg.polls >= 3) {
                                    tg.connected = true;
                                    return [2 /*return*/, send(res, { status: "ready", bot_username: "urban_bot", owner_user_id: "123456789", expires_at: null })];
                                }
                                return [2 /*return*/, send(res, { status: "waiting", expires_at: new Date(Date.now() + 600000).toISOString() })];
                            }
                            if (!(/^\/api\/messaging\/telegram\/onboarding\/[^/]+\/apply$/.test(url) && req.method === "POST")) return [3 /*break*/, 10];
                            return [4 /*yield*/, readBody(req)];
                        case 9:
                            b = _a.sent();
                            ids = Array.isArray(b.allowed_user_ids) ? b.allowed_user_ids : [];
                            if (!ids.length)
                                return [2 /*return*/, send(res, { detail: "Add at least one allowed Telegram user ID." }, 400)];
                            if (!ids.every(function (s) { return /^\d+$/.test(String(s)); }))
                                return [2 /*return*/, send(res, { detail: "Allowed Telegram user IDs must be numeric." }, 400)];
                            if (!tg.connected)
                                return [2 /*return*/, send(res, { detail: "Telegram setup is not ready yet." }, 409)];
                            tgP.enabled = true;
                            tgP.configured = true;
                            tgP.state = "connected";
                            tgP.restartAt = Date.now();
                            return [2 /*return*/, send(res, { ok: true, platform: "telegram", bot_username: "urban_bot", needs_restart: false, restart_started: true, restart_action: "gateway-restart", restart_pid: 4243 })];
                        case 10: 
                        // Igual ao real: rota /api desconhecida NÃO vira HTML da SPA.
                        return [2 /*return*/, send(res, { detail: "Not Found", url: url }, 404)];
                    }
                });
            }); });
        },
    };
}
