import { useEffect, useRef, useState } from "react";
import { Paperclip, SlidersHorizontal, Globe, GraduationCap, Newspaper, Code2, ArrowUp, Check, X, ChevronDown, Sparkles } from "lucide-react";
import { api, type ModelOption } from "../lib/api";

const TOOLS = [
  { id: "web", label: "Web Search", Icon: Globe },
  { id: "academic", label: "Acadêmico", Icon: GraduationCap },
  { id: "news", label: "Notícias", Icon: Newspaper },
  { id: "dev", label: "Desenvolvedor", Icon: Code2 },
];

// Composer rico estilo AIChat: textarea, dropdown de Ferramentas (vira chip
// removível), seletor de modelo com ícones + check, e botão enviar.
export function Composer({ onSend, disabled }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState<string>("");
  const [pickOpen, setPickOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listModels().then((m) => { setModels(m); if (m[0]) setModel(m[0].id); }).catch(() => setModels([]));
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) setPickOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function submit() {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  function toggleTool(id: string) {
    setActiveTools((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setToolsOpen(false);
  }

  const current = models.find((m) => m.id === model);

  return (
    <div className="rounded-2.5xl border border-stroke bg-panel p-2 shadow-composer">
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        placeholder="Pergunte qualquer coisa…"
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
        className="max-h-52 w-full resize-none bg-transparent px-3 py-3 text-sm text-title outline-none placeholder:text-text-50"
      />

      <div className="flex items-center justify-between px-1 pb-1">
        <div className="flex items-center gap-1">
          <button className="flex h-9 w-9 items-center justify-center rounded-lg text-text-100 hover:bg-background-100" title="Anexar">
            <Paperclip size={17} />
          </button>

          {/* Ferramentas — dropdown */}
          <div className="relative" ref={toolsRef}>
            <button
              onClick={() => setToolsOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-text-100 hover:bg-background-100"
            >
              <SlidersHorizontal size={16} /> Ferramentas
            </button>
            {toolsOpen && (
              <div className="absolute bottom-11 left-0 z-10 w-52 rounded-xl border border-stroke bg-panel p-1 shadow-pop">
                {TOOLS.map(({ id, label, Icon }) => (
                  <button key={id} onClick={() => toggleTool(id)} className="menu-item">
                    <Icon size={16} /> {label}
                    {activeTools.includes(id) && <Check size={15} className="ml-auto text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Chips das ferramentas ativas */}
          {activeTools.map((id) => {
            const t = TOOLS.find((x) => x.id === id)!;
            return (
              <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-3 py-1 text-sm font-medium text-primary">
                <t.Icon size={14} /> {t.label}
                <button onClick={() => toggleTool(id)} className="hover:text-primary-hover"><X size={13} /></button>
              </span>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative" ref={pickRef}>
            <button
              onClick={() => setPickOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-text-200 hover:bg-background-100"
            >
              <Sparkles size={15} className="text-claude" />
              <span className="max-w-[160px] truncate">{current?.label || current?.id || "Modelo"}</span>
              <ChevronDown size={15} className="text-text-50" />
            </button>
            {pickOpen && (
              <div className="absolute bottom-11 right-0 z-10 w-60 rounded-xl border border-stroke bg-panel p-1 shadow-pop">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setModel(m.id); setPickOpen(false); }}
                    className={["flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-background-100", m.id === model ? "bg-background-100 text-title" : "text-text-200"].join(" ")}
                  >
                    <Sparkles size={15} className="text-claude" />
                    <span className="truncate">{m.label || m.id}</span>
                    {m.id === model && <Check size={15} className="ml-auto text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={submit}
            disabled={!text.trim() || disabled}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white transition hover:bg-primary-hover disabled:bg-background-100 disabled:text-text-50"
            title="Enviar"
          >
            <ArrowUp size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
