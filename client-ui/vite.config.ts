import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mockApi } from "./dev/mock-api";

// O front do cliente é servido NA MESMA ORIGIN do dashboard em produção (o
// cookie OIDC do Keycloak flui sozinho; o WS pega um ticket em
// /api/auth/ws-ticket). Em dev, o Vite faz proxy de /api (HTTP e WS) para um
// `hermes dashboard` local (porta 9119). O dashboard em loopback exige o
// session-token do processo: HTTP via header X-Hermes-Session-Token (injetado
// pelo proxy) e WS via ?token= (o front lê VITE_SESSION_TOKEN — só em dev).
// Rode o dashboard com HERMES_DASHBOARD_SESSION_TOKEN fixo para o token bater.
// Com VITE_MOCK=1, um backend de mentira responde localmente (sem token).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useMock = env.VITE_MOCK === "1";
  const target = env.VITE_GATEWAY_URL || "http://localhost:9119";
  const token = env.VITE_SESSION_TOKEN || "";
  const withToken = token ? { headers: { "X-Hermes-Session-Token": token } as Record<string, string> } : {};
  // Dev: apontar para um profile específico do dashboard local (VITE_PROFILE).
  // Em produção a instância tem UM profile e nada disso existe.
  const profile = env.VITE_PROFILE || "";
  const withProfile = profile
    ? { rewrite: (p: string) => (p.startsWith("/api/ws") ? p : p + (p.includes("?") ? "&" : "?") + "profile=" + encodeURIComponent(profile)) }
    : {};
  return {
    plugins: [react(), ...(useMock ? [mockApi()] : [])],
    server: {
      port: 5174,
      proxy: useMock
        ? undefined
        : {
            "/api/ws": { target: target.replace(/^http/, "ws"), ws: true, changeOrigin: true },
            "/api": { target, changeOrigin: true, ...withToken, ...withProfile },
            "/auth": { target, changeOrigin: true, ...withToken },
          },
    },
    build: { outDir: "dist", sourcemap: false },
  };
});
