import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version?: string };
const appVersion = pkg.version ?? "0.0.0";

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5180,
    strictPort: false,
    proxy: {
      "/api/chat": {
        target: "https://ws.ev2090.com",
        changeOrigin: true,
        // Disable response buffering so SSE streams flow through immediately
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              // Flush each chunk immediately — required for SSE through a proxy
              proxyRes.on("data", (chunk: Buffer) => {
                res.write(chunk);
              });
              proxyRes.on("end", () => {
                res.end();
              });
            }
          });
        },
      },
    },
  },
});
