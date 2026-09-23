// Estado de UMA conversa sobre o gateway WS: cria/retoma a sessão, envia
// prompts, acumula o streaming (message.delta -> message.complete), recebe
// pedidos de aprovação/clarify e anexa imagens/arquivos antes do turno.
//
// Fluxo real (tag v2026.9.21):
//   - Nova conversa: session.create {source:"web"} -> {session_id (runtime),
//     stored_session_id (o id que aparece em GET /api/sessions)}.
//   - Conversa existente (id da lista REST = stored id): session.resume
//     {session_id:<stored>} -> {session_id:<runtime>, messages:[{role,text}]}.
//   - Enviar: prompt.submit {session_id:<runtime>, text} -> {status:"streaming"|"queued"|...}.
//     Depois chegam eventos: message.start, message.delta {text}, tool.start/complete,
//     message.complete {text, status}. Título vem por session.title.
//   - Anexos: image.attach_bytes {content_base64, filename} / file.attach {data_url, name};
//     ficam na fila e entram no PRÓXIMO prompt.submit.
//   - Pedidos: frame {id:"srq-…", method:"approval"|"clarify", params} -> responder
//     answer(id, {choice}) / answer(id, {answer}) ou clarify.lock em lote.
import { useCallback, useEffect, useRef, useState } from "react";
import { gateway, type GatewayEvent, type ServerRequest, type SessionCreateResult, type SessionResumeResult, type TranscriptMessage } from "../lib/gateway";

export interface UiMessage {
  key: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  streaming?: boolean;
  toolName?: string;
  toolDone?: boolean;
  error?: string;
}

export interface Attachment {
  id: string;
  name: string;
  kind: "image" | "file";
  size: number;
  previewUrl?: string; // object URL para imagens
  file: File;
  status: "pending" | "sending" | "attached" | "error";
  error?: string;
}

export type PendingRequest = ServerRequest & { answered?: boolean };

function keyOf(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function fromTranscript(m: TranscriptMessage): UiMessage | null {
  if (m.display_kind === "hidden") return null;
  const role = (m.role as UiMessage["role"]) || "assistant";
  if (role === "system") return null;
  if (role === "tool") {
    return { key: keyOf("t"), role, text: m.text || "", toolName: m.name || undefined, toolDone: true };
  }
  const text = (m.text ?? "") as string;
  if (!text && role === "assistant") return null; // turno só de tool calls
  return { key: keyOf(role), role, text };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export function useChatSession(storedId: string | null, onStoredIdKnown: (storedId: string) => void, onTitle?: (storedId: string, title: string) => void) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [title, setTitle] = useState<string>("");
  const [info, setInfo] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const runtimeId = useRef<string | null>(null);
  const storedRef = useRef<string | null>(storedId);
  const streamKey = useRef<string | null>(null);

  // --- eventos do gateway para ESTA sessão ------------------------------------
  useEffect(() => {
    const offEv = gateway.onEvent((ev: GatewayEvent) => {
      if (ev.session_id !== runtimeId.current) return;
      handleEvent(ev);
    });
    const offReq = gateway.onRequest((r: ServerRequest) => {
      if (r.params?.session_id !== runtimeId.current) return;
      if (r.method !== "approval" && r.method !== "clarify") {
        // Métodos que este front não implementa (sudo, secret, vault…): responde vazio
        // na hora, senão o agente espera o timeout inteiro.
        gateway.answer(r.id, {});
        return;
      }
      setRequests((cur) => [...cur.filter((x) => x.id !== r.id), r]);
    });
    return () => { offEv(); offReq(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleEvent(ev: GatewayEvent) {
    const p = ev.payload || {};
    switch (ev.type) {
      case "message.start": {
        setRunning(true);
        const k = keyOf("a");
        streamKey.current = k;
        setMessages((m) => [...m, { key: k, role: "assistant", text: "", streaming: true }]);
        break;
      }
      case "message.delta": {
        const k = streamKey.current;
        if (!k) { // delta sem start (turno retomado): abre a bolha agora
          const nk = keyOf("a");
          streamKey.current = nk;
          setMessages((m) => [...m, { key: nk, role: "assistant", text: p.text || "", streaming: true }]);
          break;
        }
        setMessages((m) => m.map((x) => (x.key === k ? { ...x, text: x.text + (p.text || "") } : x)));
        break;
      }
      case "message.complete": {
        const k = streamKey.current;
        streamKey.current = null;
        setRunning(false);
        const finalText = typeof p.text === "string" ? p.text : "";
        setMessages((m) => {
          const has = k && m.some((x) => x.key === k);
          if (has) {
            return m.map((x) => (x.key === k
              ? { ...x, streaming: false, text: finalText || x.text, error: p.error || undefined }
              : x));
          }
          if (!finalText && !p.error) return m;
          return [...m, { key: keyOf("a"), role: "assistant", text: finalText, error: p.error || undefined }];
        });
        if (p.error) setError(String(p.error));
        break;
      }
      case "tool.start": {
        setMessages((m) => [...m, { key: `tool-${p.tool_id}`, role: "tool", text: p.preview || p.args_text || "", toolName: p.name }]);
        break;
      }
      case "tool.complete": {
        setMessages((m) => m.map((x) => (x.key === `tool-${p.tool_id}` ? { ...x, toolDone: true, text: p.summary || x.text } : x)));
        break;
      }
      case "session.title": {
        if (p.title) {
          setTitle(p.title);
          if (storedRef.current && onTitle) onTitle(storedRef.current, p.title);
        }
        break;
      }
      case "session.info": {
        setInfo(p);
        if (p.title) setTitle(p.title);
        if (typeof p.running === "boolean") setRunning(p.running);
        break;
      }
      case "request.cancel": {
        setRequests((cur) => cur.filter((r) => r.id !== p.id));
        break;
      }
      case "error": {
        setError(p.message || "erro do gateway");
        break;
      }
      default:
        break;
    }
  }

  // --- abrir/retomar a sessão -------------------------------------------------
  // Não usa flag `cancelled` por efeito: em StrictMode o efeito roda 2x e o
  // cleanup do 1º descartava o resultado válido (histórico ficava em
  // "Carregando…"). O critério é "o resultado ainda é da conversa ativa?".
  useEffect(() => {
    storedRef.current = storedId;
    runtimeId.current = null;
    streamKey.current = null;
    setMessages([]); setRequests([]); setAttachments([]); setError(null); setTitle(""); setInfo({}); setRunning(false);
    if (!storedId) { setLoading(false); return; } // nova conversa: cria só no primeiro envio
    setLoading(true);
    const stillActive = () => storedRef.current === storedId;
    (async () => {
      try {
        await gateway.connect();
        const r = await gateway.call<SessionResumeResult>("session.resume", { session_id: storedId, source: "web" });
        if (!stillActive()) return;
        runtimeId.current = r.session_id;
        setMessages((r.messages || []).map(fromTranscript).filter((x): x is UiMessage => !!x));
        setInfo(r.info || {});
        setTitle((r.info?.title as string) || "");
        setRunning(!!r.running);
        // Pedidos ainda abertos (reconexão): reentrega.
        const open = (r.open_requests || []).filter((q) => q.method === "approval" || q.method === "clarify");
        if (open.length) setRequests(open);
      } catch (e: any) {
        if (stillActive()) setError(e?.message || "não foi possível abrir a conversa");
      } finally {
        if (stillActive()) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedId]);

  async function ensureSession(): Promise<string> {
    if (runtimeId.current) return runtimeId.current;
    await gateway.connect();
    const r = await gateway.call<SessionCreateResult>("session.create", { source: "web" });
    runtimeId.current = r.session_id;
    storedRef.current = r.stored_session_id;
    setInfo(r.info || {});
    onStoredIdKnown(r.stored_session_id);
    return r.session_id;
  }

  // --- anexos -----------------------------------------------------------------
  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).map<Attachment>((file) => ({
      id: keyOf("att"),
      name: file.name,
      kind: file.type.startsWith("image/") ? "image" : "file",
      size: file.size,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      file,
      status: "pending",
    }));
    setAttachments((a) => [...a, ...list]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((a) => {
      const gone = a.find((x) => x.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return a.filter((x) => x.id !== id);
    });
  }, []);

  // Imagens entram na fila do gateway e vão sozinhas no próximo turno. Arquivos
  // NÃO: file.attach só grava o arquivo e devolve ref_text ("@file:caminho");
  // a referência precisa ir DENTRO do texto do prompt (é assim que o desktop
  // faz), senão o modelo nem sabe que o arquivo existe.
  async function flushAttachments(sid: string): Promise<string[]> {
    const refs: string[] = [];
    const pend = attachments.filter((a) => a.status === "pending" || a.status === "error");
    for (const a of pend) {
      setAttachments((cur) => cur.map((x) => (x.id === a.id ? { ...x, status: "sending" } : x)));
      try {
        const dataUrl = await readAsDataUrl(a.file);
        if (a.kind === "image") {
          const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          const r = await gateway.call<{ attached: boolean; message?: string }>("image.attach_bytes", { session_id: sid, content_base64: b64, filename: a.name });
          if (!r?.attached) throw new Error(r?.message || "imagem recusada");
        } else {
          const r = await gateway.call<{ attached: boolean; ref_text?: string }>("file.attach", { session_id: sid, data_url: dataUrl, name: a.name });
          if (!r?.attached) throw new Error("arquivo recusado");
          if (r.ref_text) refs.push(r.ref_text);
        }
        setAttachments((cur) => cur.map((x) => (x.id === a.id ? { ...x, status: "attached" } : x)));
      } catch (e: any) {
        setAttachments((cur) => cur.map((x) => (x.id === a.id ? { ...x, status: "error", error: e?.message || "falha no envio" } : x)));
        throw e;
      }
    }
    return refs;
  }

  // --- enviar -----------------------------------------------------------------
  const send = useCallback(async (text: string) => {
    setError(null);
    const attNames = attachments.map((a) => a.name);
    const shown = text || (attNames.length ? `📎 ${attNames.join(", ")}` : "");
    setMessages((m) => [...m, { key: keyOf("u"), role: "user", text: shown }]);
    try {
      const sid = await ensureSession();
      const refs = await flushAttachments(sid);
      const fullText = refs.length ? `${text}\n\n${refs.join("\n")}` : text;
      const r = await gateway.call<{ status?: string }>("prompt.submit", { session_id: sid, text: fullText, surface: "web" });
      if (r?.status === "streaming" || r?.status === "queued") setRunning(true);
      setAttachments((a) => { a.forEach((x) => x.previewUrl && URL.revokeObjectURL(x.previewUrl)); return []; });
    } catch (e: any) {
      setError(e?.message || "falha ao enviar");
      setRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments]);

  const interrupt = useCallback(async () => {
    if (!runtimeId.current) return;
    await gateway.call("session.interrupt", { session_id: runtimeId.current }).catch(() => {});
  }, []);

  // --- responder pedidos ------------------------------------------------------
  const answerApproval = useCallback((req: PendingRequest, choice: string) => {
    gateway.answer(req.id, { choice });
    setRequests((cur) => cur.filter((r) => r.id !== req.id));
  }, []);

  const answerClarify = useCallback(async (req: PendingRequest, answer: string, qid?: string) => {
    if (req.params?.questions && qid) {
      const r = await gateway.call<{ status: string; remaining?: string[] }>("clarify.lock", { request_id: req.id, question_id: qid, answer });
      if (!r?.remaining?.length) setRequests((cur) => cur.filter((x) => x.id !== req.id));
      return;
    }
    gateway.answer(req.id, { answer });
    setRequests((cur) => cur.filter((r) => r.id !== req.id));
  }, []);

  return { messages, loading, running, title, info, error, requests, attachments, send, interrupt, addFiles, removeAttachment, answerApproval, answerClarify, runtimeId: runtimeId.current };
}
