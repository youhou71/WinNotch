/**
 * Augmentation globale : déclare le shape de `window.notch` pour TypeScript.
 * Importé automatiquement par le renderer grâce à `tsconfig.web.json`.
 */
import type { NotchApi } from '../shared/types';

declare global {
  interface Window {
    notch: NotchApi;
  }
}

export {};
