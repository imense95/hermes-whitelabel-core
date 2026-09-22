var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
// O front do cliente é servido NA MESMA ORIGIN do gateway em produção (o cookie
// OIDC do Keycloak flui sozinho). Em dev, o Vite faz proxy de /api e /v1 para o
// gateway e injeta o session-token via header (HERMES_DASHBOARD_SESSION_TOKEN).
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), "");
    var target = env.VITE_GATEWAY_URL || "http://127.0.0.1:8642";
    var token = env.VITE_SESSION_TOKEN || "";
    var withToken = token
        ? { headers: { "X-Hermes-Session": token } }
        : {};
    return {
        plugins: [react()],
        server: {
            port: 5174,
            proxy: {
                "/api": __assign({ target: target, changeOrigin: true }, withToken),
                "/v1": __assign({ target: target, changeOrigin: true }, withToken),
            },
        },
        build: { outDir: "dist", sourcemap: false },
    };
});
