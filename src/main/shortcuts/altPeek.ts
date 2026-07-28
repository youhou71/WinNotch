/**
 * Mode Peek (Alt maintenu) — quand l'utilisateur maintient Alt n'importe
 * où dans Windows, on rend le notch translucide (opacité 0.15) et
 * totalement click-through.
 *
 * Détection : polling `GetAsyncKeyState(VK_MENU)` à ~75 ms dans la boucle
 * PowerShell résidente du détecteur fullscreen (cf. `fullscreenDetector.ts`
 * + `resources/ps/fullscreen-detector.ps1`), qui n'émet que les transitions
 * DOWN/UP. Ce module se contente d'enregistrer le handler via
 * `setAltKeyHandler` — il doit donc être démarré AVANT
 * `startFullscreenDetector()` (ordre garanti dans `index.ts`).
 *
 * Pourquoi plus de hook clavier global (`node-global-key-listener`,
 * retiré) ? Un hook WH_KEYBOARD_LL fait transiter CHAQUE frappe de chaque
 * application par un aller-retour pipe vers l'event loop Node. Dès que le
 * main process bloque (I/O synchrone, GC…), c'est la latence clavier de
 * tout Windows qui en pâtit. Le polling est hors du chemin critique
 * clavier : coût fixe négligeable, latence de détection ≤ 75 ms
 * (imperceptible pour un effet d'opacité).
 *
 * Pourquoi pas d'interception d'Escape ici (pour fermer le notch) ?
 * Un polling (comme les hooks Node d'ailleurs) **observe** sans bloquer :
 * l'event continue vers l'app foreground. Capter Esc fermerait certes le
 * notch, mais sortirait aussi YouTube du fullscreen, fermerait les menus
 * Chrome, etc. UX cassée.
 *
 * Méthodes de fermeture du notch en place à la place :
 *  - `Ctrl+Shift+Space` re-toggle (via globalShortcut)
 *  - Clic outside (via blur listener → shell:requestCollapse)
 *  - Esc local quand le focus est sur la search bar (useKeyboardShortcuts)
 */
import { IpcChannel, type NotchMode } from '../../shared/types';
import { getNotchWindow } from '../window/notchWindow';
import { setPeekState } from '../ipc/mouse';
import { setAltKeyHandler } from '../modules/shell/fullscreenDetector';

/** État Peek courant — sert de dedup (filet : le script PS n'émet déjà que les transitions). */
let peekActive = false;

/**
 * Mode courant du notch — maintenu via `setNotchMode`. Conservé même
 * si on n'utilise plus Esc-block ici : utile pour de futures features
 * conditionnelles au mode (toasts qui ne push que si collapsed, etc.).
 */
let currentMode: NotchMode = 'collapsed';

/**
 * Abonnés au changement de mode. Permet aux pollers coûteux de se mettre en
 * veille quand le notch est replié et de se resynchroniser à l'ouverture,
 * sans que `altPeek` ait à connaître les modules concernés.
 */
type NotchModeListener = (mode: NotchMode) => void;
const modeListeners = new Set<NotchModeListener>();

/** S'abonne aux changements de mode. Renvoie la fonction de désabonnement. */
export function onNotchModeChange(listener: NotchModeListener): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}

/** Met à jour le mode courant. Appelé depuis globalShortcuts.ts. */
export function setNotchMode(mode: NotchMode): void {
  if (currentMode === mode) return;
  currentMode = mode;
  for (const listener of modeListeners) {
    try {
      listener(mode);
    } catch (err) {
      // Un abonné qui throw ne doit pas empêcher les autres d'être notifiés,
      // ni casser le changement de mode lui-même.
      console.warn('[altPeek] listener de mode en échec:', err);
    }
  }
}

/**
 * Mode courant du notch. Utilisé par les pollers du main (systemService)
 * pour distinguer « masqué pour fullscreen » de « ouvert par-dessus le
 * fullscreen via Ctrl+Shift+Space » (le mode expanded override la classe
 * de masquage côté renderer).
 */
export function getNotchMode(): NotchMode {
  return currentMode;
}

/**
 * Notifie main + renderer du changement d'état Peek.
 *  - `setPeekState` reconfigure setIgnoreMouseEvents côté fenêtre
 *  - Le push IPC permet au renderer d'appliquer la classe CSS `.is-peeking`
 */
function emitPeek(on: boolean): void {
  if (on === peekActive) return;
  peekActive = on;
  setPeekState(on);
  const win = getNotchWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannel.PeekChange, on);
  }
}

/**
 * Branche le mode Peek sur le poller Alt du détecteur fullscreen.
 * À appeler avant `startFullscreenDetector()` : la présence du handler au
 * spawn active le polling Alt côté script PS.
 */
export function startAltPeekListener(): void {
  setAltKeyHandler(emitPeek);
}

/** Débranche le handler Alt. Appelé à la fermeture de l'app. */
export function stopAltPeekListener(): void {
  setAltKeyHandler(null);
  // Ne jamais laisser la fenêtre coincée en passe-plats si on coupe
  // pendant un maintien d'Alt.
  emitPeek(false);
}
