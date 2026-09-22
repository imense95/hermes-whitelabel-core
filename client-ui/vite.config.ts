import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mockApi } from "./dev/mock-api";

// O front do cliente é servido NA MESMA ORIGIN do gateway em produção (o cookie
// OIDC do Keycloak flui sozinho). Em dev, o Vite faz proxy de /api e /v1 para o
// gateway e injeta o session-token via header (HERMES_DASHBOARD_SESSION_TOKEN).
// Com VITE_MOCK=1, um backend de mentira responde localmente (sem token/OIDC).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useMock = env.VITE_MOCK === "1";
  const target = env.VITE_GATEWAY_URL || "http://localhost:8642";
  const token = env.VITE_SESSION_TOKEN || "";
  const withToken = token
    ? { headers: { "X-Hermes-Session": token } as Record<string, string> }
    : {};
  return {
    plugins: [react(), ...(useMock ? [mockApi()] : [])],
    server: {
      port: 5174,
      proxy: useMock
        ? undefined
        : {
            "/api": { target, changeOrigin: true, ...withToken },
            "/v1": { target, changeOrigin: true, ...withToken },
          },
    },
    build: { outDir: "dist", sourcemap: false },
  };
});
