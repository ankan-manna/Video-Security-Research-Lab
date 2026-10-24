import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        lab: {
          bg: "#05070a",
          panel: "#0c1016",
          border: "#1d2630",
          accent: "#39ff9f",
          accent2: "#2bd1ff",
          danger: "#ff4d6d",
          warn: "#ffcc66",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
