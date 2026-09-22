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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mockApi } from "./dev/mock-api";
// O front do cliente é servido NA MESMA ORIGIN do gateway em produção (o cookie
// OIDC do Keycloak flui sozinho). Em dev, o Vite faz proxy de /api e /v1 para o
// gateway e injeta o session-token via header (HERMES_DASHBOARD_SESSION_TOKEN).
// Com VITE_MOCK=1, um backend de mentira responde localmente (sem token/OIDC).
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), "");
    var useMock = env.VITE_MOCK === "1";
    var target = env.VITE_GATEWAY_URL || "http://localhost:8642";
    var token = env.VITE_SESSION_TOKEN || "";
    var withToken = token
        ? { headers: { "X-Hermes-Session": token } }
        : {};
    return {
        plugins: __spreadArray([react()], (useMock ? [mockApi()] : []), true),
        server: {
            port: 5174,
            proxy: useMock
                ? undefined
                : {
                    "/api": __assign({ target: target, changeOrigin: true }, withToken),
                    "/v1": __assign({ target: target, changeOrigin: true }, withToken),
                },
        },
        build: { outDir: "dist", sourcemap: false },
    };
});
