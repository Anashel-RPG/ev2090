import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const apiPort = process.env.API_PORT ?? "8787";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5181,
    host: true,
    proxy: {
      "/api/admin": {
        // In dev, proxy to local wrangler. In production admin.ev2090.com talks directly.
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
