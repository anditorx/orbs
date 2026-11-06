import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.ORBS_API_URL ?? "http://localhost:8787";
// Extra host names the dev server answers to, comma separated (for example ".trycloudflare.com" when the app is
// reached through an HTTPS tunnel, which some services require for sign-in callbacks).
const allowedHosts = (process.env.ORBS_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    ...(allowedHosts.length > 0 && { allowedHosts }),
    // Same-origin in development: auth cookies and RPC calls go through the Vite proxy.
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/rpc": { target: api, changeOrigin: false },
    },
  },
});
