import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version?: string;
};
const appVersion = pkg.version ?? "0.0.0";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // `devworker` mode is used by the repo root `npm run dev` script to proxy API calls
  // to the local worker (`wrangler dev`) instead of production.
  const defaultApiTarget = mode === "devworker" ? "http://127.0.0.1:8787" : "https://ws.ev2090.com";
  const apiTarget = env.VITE_API_PROXY_TARGET?.trim() || defaultApiTarget;

  return {
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
      port: parseInt(process.env.FRONTEND_PORT ?? "5180"),
      strictPort: false,
      host: true,
      proxy: {
        "/api/chat": {
          target: apiTarget,
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
        "/api/board": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/api/forge": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/api/market": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/api/auth": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/api/player": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/api/trade": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
