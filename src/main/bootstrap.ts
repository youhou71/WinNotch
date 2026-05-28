/**
 * Side-effect import qui isole la config du mode dev (`npm run dev`) de
 * celle de l'app installée. Sans cela, les deux partageraient
 * `%APPDATA%\WinNotch\config.json` (comportement Electron par défaut :
 * `userData` est dérivé du productName, identique en dev et en prod).
 *
 * Doit rester le tout premier import de `index.ts` — les services
 * (`settingsService`, `gitlabService`, `clipboardStore`, etc.) instancient
 * `new Store()` au top-level, et `electron-store` résout le chemin du
 * fichier au moment de la construction. L'override doit donc précéder
 * l'évaluation de ces modules.
 */
import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

if (!app.isPackaged) {
  const devUserData = join(app.getPath('appData'), 'WinNotch-dev');
  // `app.setPath` exige que le dossier existe sous peine de throw.
  mkdirSync(devUserData, { recursive: true });
  app.setPath('userData', devUserData);
  console.log(`[WinNotch] Mode dev — userData isolé dans ${devUserData}`);
}
