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
// O front do cliente é servido NA MESMA ORIGIN do dashboard em produção (o
// cookie OIDC do Keycloak flui sozinho; o WS pega um ticket em
// /api/auth/ws-ticket). Em dev, o Vite faz proxy de /api (HTTP e WS) para um
// `hermes dashboard` local (porta 9119). O dashboard em loopback exige o
// session-token do processo: HTTP via header X-Hermes-Session-Token (injetado
// pelo proxy) e WS via ?token= (o front lê VITE_SESSION_TOKEN — só em dev).
// Rode o dashboard com HERMES_DASHBOARD_SESSION_TOKEN fixo para o token bater.
// Com VITE_MOCK=1, um backend de mentira responde localmente (sem token).
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), "");
    var useMock = env.VITE_MOCK === "1";
    var target = env.VITE_GATEWAY_URL || "http://localhost:9119";
    var token = env.VITE_SESSION_TOKEN || "";
    var withToken = token ? { headers: { "X-Hermes-Session-Token": token } } : {};
    // Dev: apontar para um profile específico do dashboard local (VITE_PROFILE).
    // Em produção a instância tem UM profile e nada disso existe.
    var profile = env.VITE_PROFILE || "";
    var withProfile = profile
        ? { rewrite: function (p) { return (p.startsWith("/api/ws") ? p : p + (p.includes("?") ? "&" : "?") + "profile=" + encodeURIComponent(profile)); } }
        : {};
    return {
        plugins: __spreadArray([react()], (useMock ? [mockApi()] : []), true),
        server: {
            port: 5174,
            proxy: useMock
                ? undefined
                : {
                    "/api/ws": { target: target.replace(/^http/, "ws"), ws: true, changeOrigin: true },
                    "/api": __assign(__assign({ target: target, changeOrigin: true }, withToken), withProfile),
                    "/auth": __assign({ target: target, changeOrigin: true }, withToken),
                },
        },
        build: { outDir: "dist", sourcemap: false },
    };
});
