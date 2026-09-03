/// <reference types="vite/client" />

declare module '*.css';
declare module '*.svg' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  electronAPI?: {
    startServer: () => Promise<{ ip: string; port: number; code: string; status: string }>;
    stopServer: () => Promise<{ status: string }>;
    getAppVersion: () => Promise<string>;
    getLocalIP: () => Promise<string>;
    getInviteCode: () => Promise<string>;
    openExternal: (url: string) => Promise<void>;
  };
}