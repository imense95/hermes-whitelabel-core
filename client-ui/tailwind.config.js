/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Tokens semânticos espelhando o demo AIChat da Tailgrids.
      colors: {
        background: {
          DEFAULT: "#f4f5f7", // fundo cinza atrás do painel branco
          50: "#f9fafb",
          100: "#f3f4f6",
        },
        title: { DEFAULT: "#111827", 50: "#1f2937" },
        text: {
          200: "#374151",
          100: "#4b5563",
          50: "#6b7280",
        },
        stroke: { DEFAULT: "#e5e7eb", light: "#f0f1f3" },
        primary: { DEFAULT: "#4f46e5", hover: "#4338ca", light: "#eef2ff" },
        claude: "#d97757",
        // compat com componentes antigos
        body: "#6b7280",
        dark: "#111827",
        surface: "#f9fafb",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      borderRadius: { "2.5xl": "1.25rem" },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
        panel: "0 1px 2px 0 rgb(0 0 0 / 0.03)",
        composer: "0 2px 12px -4px rgb(0 0 0 / 0.10), 0 0 0 1px rgb(0 0 0 / 0.05)",
        pop: "0 10px 30px -10px rgb(0 0 0 / 0.25)",
      },
    },
  },
  plugins: [],
};
