import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mockApi } from "./dev/mock-api";

// O painel da assessoria e' um servico proprio (subdominio admin.DOMINIO),
// atras do mesmo Keycloak. Fala com a release-engine/panel-api em /api.
// Em dev, o Vite faz proxy de /api para a release-engine local (porta 8779).
// Com VITE_MOCK=1, um backend de mentira responde localmente (sem token) —
// e' o modo usado para desenvolver e testar as telas sem infra.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useMock = mode === "mock" || env.VITE_MOCK === "1";
  const target = env.VITE_API_URL || "http://localhost:8779";
  return {
    plugins: [react(), ...(useMock ? [mockApi()] : [])],
    server: {
      port: 5175,
      proxy: useMock
        ? undefined
        : {
            "/api": { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
          },
    },
    build: { outDir: "dist", sourcemap: false },
  };
});
