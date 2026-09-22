import { useEffect, useState } from "react";
import { X } from "lucide-react";

// Modal "Criar novo projeto" — espelha o do demo AIChat: título, input,
// Cancelar + Criar (desabilitado enquanto vazio).
export function NewProjectModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-title">Criar novo projeto</h2>
          <button onClick={onClose} className="text-text-50 hover:text-title"><X size={18} /></button>
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onCreate(name.trim()); onClose(); } }}
          placeholder="Nome do projeto"
          className="input"
        />
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="btn-outline">Cancelar</button>
          <button
            disabled={!name.trim()}
            onClick={() => { onCreate(name.trim()); onClose(); }}
            className="btn"
          >
            Criar projeto
          </button>
        </div>
      </div>
    </div>
  );
}
