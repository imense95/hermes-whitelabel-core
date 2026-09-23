import { useEffect, useRef, useState } from "react";
import { Paperclip, ArrowUp, Square, X, FileText, Check, ChevronDown, Sparkles } from "lucide-react";
import { api, modelLabel } from "../lib/api";
import type { Attachment } from "../lib/useChatSession";

// Composer: textarea + anexos (arquivo/imagem/vídeo: botão, arrastar, colar) +
// seletor de modelo (só visualização nesta fatia: mostra o modelo atual da
// instância; trocar modelo por sessão fica para a fatia seguinte) + enviar/parar.
export function Composer({
  onSend,
  onStop,
  running,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  currentModel,
}: {
  onSend: (text: string) => void;
  onStop?: () => void;
  running?: boolean;
  attachments: Attachment[];
  onAddFiles: (f: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
  currentModel?: string;
}) {
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [models, setModels] = useState<{ id: string; provider: string; current: boolean }[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.modelOptions().then((r) => {
      const provs = Array.isArray(r?.providers) ? r.providers : [];
      const list: { id: string; provider: string; current: boolean }[] = [];
      for (const p of provs) {
        if (p.authenticated === false) continue;
        for (const m of p.models || []) list.push({ id: m, provider: p.name || p.slug, current: !!p.is_current && m === r.model });
      }
      setModels(list);
      setDefaultModel(r?.model || "");
    }).catch(() => { setModels([]); setDefaultModel(""); });
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (pickRef.current && !pickRef.current.contains(e.target as Node)) setPickOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !running;

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  const shown = currentModel || defaultModel;

  return (
    <div
      className={["rounded-2.5xl border bg-panel p-2 shadow-composer transition", dragOver ? "border-primary ring-2 ring-primary/30" : "border-stroke"].join(" ")}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) onAddFiles(e.dataTransfer.files); }}
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2 pt-1">
          {attachments.map((a) => (
            <div key={a.id} className="group relative flex items-center gap-2 rounded-lg border border-stroke bg-background-50 p-1.5 pr-2 text-xs text-text-200">
              {a.kind === "image" && a.previewUrl ? (
                <img src={a.previewUrl} alt={a.name} className="h-12 w-12 rounded-md object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-md bg-background-100 text-text-50"><FileText size={20} /></span>
              )}
              <span className="max-w-[140px]">
                <span className="block truncate font-medium" title={a.name}>{a.name}</span>
                <span className="block text-text-50">
                  {a.status === "sending" ? "enviando…" : a.status === "error" ? (a.error || "erro") : `${(a.size / 1024).toFixed(0)} KB`}
                </span>
              </span>
              <button onClick={() => onRemoveAttachment(a.id)} className="ml-1 rounded-md p-0.5 text-text-50 hover:bg-background-100 hover:text-title" title="Remover"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        rows={1}
        value={text}
        placeholder={running ? "O assistente está respondendo…" : "Pergunte qualquer coisa… (cole ou arraste imagens e arquivos)"}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files || []);
          if (files.length) { e.preventDefault(); onAddFiles(files); }
        }}
        className="max-h-52 w-full resize-none bg-transparent px-3 py-3 text-sm text-title outline-none placeholder:text-text-50"
      />

      <div className="flex items-center justify-between px-1 pb-1">
        <div className="flex items-center gap-1">
          <input ref={fileRef} type="file" multiple className="hidden" accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json,.docx,.xlsx,.pptx,.zip"
            onChange={(e) => { if (e.target.files?.length) onAddFiles(e.target.files); e.currentTarget.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-text-100 hover:bg-background-100" title="Anexar arquivo, foto ou vídeo">
            <Paperclip size={17} /> Anexar
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative" ref={pickRef}>
            <button onClick={() => setPickOpen((v) => !v)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-text-200 hover:bg-background-100" title="Modelo em uso nesta instância">
              <Sparkles size={15} className="text-claude" />
              <span className="max-w-[180px] truncate">{shown ? modelLabel(shown) : "Modelo"}</span>
              <ChevronDown size={15} className="text-text-50" />
            </button>
            {pickOpen && (
              <div className="absolute bottom-11 right-0 z-10 max-h-72 w-72 overflow-y-auto rounded-xl border border-stroke bg-panel p-1 shadow-pop">
                <p className="px-3 py-2 text-xs text-text-50">Modelo definido pela equipe. Esta lista é só consulta.</p>
                {models.length === 0 && <p className="px-3 py-2 text-sm text-text-50">Nenhum modelo configurado.</p>}
                {models.map((m) => (
                  <div key={`${m.provider}/${m.id}`} className={["flex items-center gap-2 rounded-lg px-3 py-2 text-sm", m.id === shown ? "bg-background-100 text-title" : "text-text-200"].join(" ")}>
                    <Sparkles size={14} className="shrink-0 text-claude" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{modelLabel(m.id)}</span>
                      <span className="block truncate text-xs text-text-50">{m.provider}</span>
                    </span>
                    {m.id === shown && <Check size={15} className="text-primary" />}
                  </div>
                ))}
              </div>
            )}
          </div>

          {running ? (
            <button onClick={onStop} className="flex h-9 w-9 items-center justify-center rounded-full bg-background-100 text-title transition hover:bg-red-100 hover:text-red-600" title="Parar">
              <Square size={15} />
            </button>
          ) : (
            <button onClick={submit} disabled={!canSend} className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white transition hover:bg-primary-hover disabled:bg-background-100 disabled:text-text-50" title="Enviar">
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
