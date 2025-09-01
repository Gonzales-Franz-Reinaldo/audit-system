/// <reference types="vite/client" />

// Declaraciones de tipos para variables de entorno
interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    readonly VITE_APP_TITLE: string;
    readonly VITE_APP_VERSION: string;
    readonly VITE_ENV: 'development' | 'production' | 'test';
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

// Declaración global para la versión de la app
declare const __APP_VERSION__: string;