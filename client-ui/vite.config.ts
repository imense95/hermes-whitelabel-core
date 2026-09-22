import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// O front do cliente é servido NA MESMA ORIGIN do gateway em produção (o cookie
// OIDC do Keycloak flui sozinho). Em dev, o Vite faz proxy de /api e /v1 para o
// gateway e injeta o session-token via header (HERMES_DASHBOARD_SESSION_TOKEN).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_GATEWAY_URL || "http://127.0.0.1:8642";
  const token = env.VITE_SESSION_TOKEN || "";
  const withToken = token
    ? { headers: { "X-Hermes-Session": token } as Record<string, string> }
    : {};
  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        "/api": { target, changeOrigin: true, ...withToken },
        "/v1": { target, changeOrigin: true, ...withToken },
      },
    },
    build: { outDir: "dist", sourcemap: false },
  };
});
