/**
 * Augmentation des types pour les variables d'environnement injectées
 * par electron-vite au build du main process. Toute variable préfixée
 * `MAIN_VITE_*` dans `.env.local` (ou `.env`) est inlinée dans le
 * bundle via `import.meta.env.MAIN_VITE_*`.
 *
 * Ce fichier est référencé par tsconfig.node.json (include `src/main/**`).
 */
interface ImportMetaEnv {
  readonly MAIN_VITE_AZURE_CLIENT_ID?: string;
  readonly MAIN_VITE_AZURE_TENANT_ID?: string;
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string;
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
