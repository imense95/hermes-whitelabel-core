/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "rgb(var(--background) / <alpha-value>)",
          50: "rgb(var(--background-50) / <alpha-value>)",
          100: "rgb(var(--background-100) / <alpha-value>)",
        },
        title: { DEFAULT: "rgb(var(--title) / <alpha-value>)" },
        text: {
          200: "rgb(var(--text-200) / <alpha-value>)",
          100: "rgb(var(--text-100) / <alpha-value>)",
          50: "rgb(var(--text-50) / <alpha-value>)",
        },
        stroke: {
          DEFAULT: "rgb(var(--stroke) / <alpha-value>)",
          light: "rgb(var(--stroke-light) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          hover: "rgb(var(--primary-hover) / <alpha-value>)",
          light: "rgb(var(--primary-light) / <alpha-value>)",
        },
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
      },
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "sans-serif"] },
      borderRadius: { "2.5xl": "1.25rem" },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
        pop: "0 10px 30px -10px rgb(0 0 0 / 0.25)",
      },
    },
  },
  plugins: [],
};
