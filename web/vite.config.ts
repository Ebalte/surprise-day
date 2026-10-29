import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE — подпапка сайта. На GitHub Pages это /<имя-репозитория>/, локально — "/".
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  server: { port: 5173, host: true },
});
