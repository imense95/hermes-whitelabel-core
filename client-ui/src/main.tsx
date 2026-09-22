import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { handleCallback } from "./lib/auth";
import { initTheme } from "./lib/theme";
import "./index.css";

initTheme(); // aplica o tema salvo antes do render (evita flash)


// Rota de callback do OIDC (Authorization Code + PKCE). Ao voltar do Keycloak,
// finaliza o login e redireciona para a raiz.
async function boot() {
  if (window.location.pathname === "/auth/callback") {
    try {
      await handleCallback();
    } catch {
      /* segue para a app; o gate mostra o estado */
    }
    window.history.replaceState({}, "", "/");
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
