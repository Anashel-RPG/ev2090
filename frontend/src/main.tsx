import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

console.info(`[EV] frontend v${__APP_VERSION__}`);
(window as unknown as Record<string, unknown>).__EV_FRONTEND_VERSION__ =
  __APP_VERSION__;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
