import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.ORBS_API_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in development: auth cookies and RPC calls go through the Vite proxy.
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/rpc": { target: api, changeOrigin: false },
    },
  },
});
