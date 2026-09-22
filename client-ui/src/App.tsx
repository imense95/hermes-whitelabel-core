import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { SettingsModal } from "./components/SettingsModal";

// Painel do cliente — layout chat-first (estilo AIChat/Tailgrids):
// sidebar de conversas + área de chat central + modal de configurações.
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const [session, setSession] = useState<string | null>(params.get("s"));
  const [settingsOpen, setSettingsOpen] = useState(params.get("settings") === "1");

  return (
    <div className="flex h-screen bg-background sm:p-2">
      <Sidebar
        activeSession={session}
        onSelectSession={setSession}
        onNewChat={() => setSession(null)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="flex flex-1 flex-col p-2">
        <ChatArea sessionId={session} />
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
