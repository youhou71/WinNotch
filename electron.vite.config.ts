/**
 * Configuration electron-vite : trois sections indépendantes pour main,
 * preload et renderer.
 *
 * `externalizeDepsPlugin()` empêche le bundling des modules natifs ou
 * lourds (electron, loudness) ; ils restent chargés via `require` Node à
 * l'exécution. Sans ce plugin, Vite essaierait de bundler le binaire natif
 * et la compilation échouerait.
 *
 * Les alias `@shared` et `@renderer` permettent des imports propres
 * (`import { ... } from '@shared/types'`) plutôt que des chemins relatifs
 * profonds (`../../../shared/types`).
 */
import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      rollupOptions: {
        // Deux entrées main :
        //  - index.ts        : process principal Electron
        //  - smtcWorker.ts   : utility process isolé qui parle à SMTC
        //                      (un crash natif ne tue que ce sous-process)
        input: {
          index: resolve('src/main/index.ts'),
          smtcWorker: resolve('src/main/modules/music/smtcWorker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react()],
  },
});
