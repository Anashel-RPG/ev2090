/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Admin API key — enables ship creation/deletion in the hangar. */
  readonly VITE_FORGE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
