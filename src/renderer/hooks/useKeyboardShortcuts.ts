/**
 * Raccourcis clavier locaux (fenêtre du Notch focused).
 *
 * Phase 3 : aucun raccourci local — tous sont gérés ailleurs :
 *  - **Esc** : `useEscapeKey` branché dans chaque vue (GitLabPanel,
 *    SettingsView, mode search dans ExpandedDashboard). Le composant le
 *    plus profond se ferme en premier, comme le bouton souris XButton1.
 *  - **Ctrl+Shift+Space** : raccourci global enregistré côté main
 *    process pour pouvoir ouvrir le notch depuis n'importe quelle app.
 *  - **Ctrl+Shift+D** : raccourci global pour basculer le mode DND.
 *
 * Ce hook est conservé pour héberger les futurs raccourcis purement
 * locaux (Ctrl+F pour focus search, etc.). Vide pour l'instant.
 */
import type { NotchMode } from '../../shared/types';

interface Options {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setMode: (updater: (m: NotchMode) => NotchMode) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useKeyboardShortcuts(_opts: Options): void {
  // Aucun listener actif — placeholder pour futurs raccourcis locaux.
}
