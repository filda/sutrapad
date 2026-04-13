/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_SUTRAPAD_FILE_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
