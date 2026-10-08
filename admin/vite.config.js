import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard is served by the Node server under /admin; in dev, /api is proxied to it.
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3000", "/uploads": "http://localhost:3000", "/a": "http://localhost:3000" } },
  build: { outDir: "dist", sourcemap: false },
});
