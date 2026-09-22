import { useEffect, useRef, useState } from "react";
import { api, type ModelOption } from "../lib/api";

// Composer rico estilo AIChat: textarea "Pergunte qualquer coisa", barra inferior
// com anexo + Tools à esquerda, seletor de modelo + botão enviar à direita.
export function Composer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState<string>("");
  const [pickOpen, setPickOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api
      .listModels()
      .then((m) => {
        setModels(m);
        if (m[0]) setModel(m[0].id);
      })
      .catch(() => setModels([]));
  }, []);

  function submit() {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  const current = models.find((m) => m.id === model);

  return (
    <div className="rounded-2.5xl border border-stroke bg-white p-2 shadow-composer">
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
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="max-h-52 w-full resize-none bg-transparent px-3 py-3 text-sm text-title outline-none placeholder:text-text-50"
      />

      <div className="flex items-center justify-between px-1 pb-1">
        <div className="flex items-center gap-1">
          <button className="flex h-9 w-9 items-center justify-center rounded-lg text-text-100 hover:bg-background-100" title="Anexar">
            📎
          </button>
          <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-text-100 hover:bg-background-100" title="Ferramentas">
            <span aria-hidden>⚙</span> Ferramentas
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* seletor de modelo */}
          <div className="relative">
            <button
              onClick={() => setPickOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-text-200 hover:bg-background-100"
            >
              <span className="text-claude" aria-hidden>✳</span>
              <span className="max-w-[160px] truncate">{current?.label || current?.id || "Modelo"}</span>
              <span className="text-text-50">▾</span>
            </button>
            {pickOpen && (
              <div className="absolute bottom-11 right-0 z-10 w-60 rounded-xl border border-stroke bg-white p-1 shadow-pop">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setModel(m.id);
                      setPickOpen(false);
                    }}
                    className={[
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-background-100",
                      m.id === model ? "text-primary" : "text-text-200",
                    ].join(" ")}
                  >
                    <span className="truncate">{m.label || m.id}</span>
                    {m.provider && <span className="text-xs text-text-50">{m.provider}</span>}
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
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
