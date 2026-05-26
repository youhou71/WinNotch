/**
 * Capture globale du clavier via `node-global-key-listener` (keyserver
 * natif Windows en sous-process).
 *
 * Usage : **Mode Peek (Alt maintenu)** — quand l'utilisateur maintient
 * Alt n'importe où dans Windows, on rend le notch translucide
 * (opacité 0.15) et totalement click-through.
 *
 * Pourquoi pas d'interception d'Escape ici (pour fermer le notch) ?
 * Toutes les libs Node pour Windows (`node-global-key-listener`,
 * `uiohook-napi`, `iohook`…) ne bloquent **pas réellement** les events
 * — elles observent mais l'event continue vers l'app foreground (round-
 * trip stdin trop lent pour le WH_KEYBOARD_LL timeout). Capter Esc
 * fermerait certes le notch, mais sortirait aussi YouTube du fullscreen,
 * fermerait les menus Chrome, etc. UX cassée.
 *
 * Méthodes de fermeture du notch en place à la place :
 *  - `Ctrl+Shift+Space` re-toggle (via globalShortcut)
 *  - Clic outside (via blur listener → shell:requestCollapse)
 *  - Esc local quand le focus est sur la search bar (useKeyboardShortcuts)
 */
import { IpcChannel, type NotchMode } from '../../shared/types';
import { getNotchWindow } from '../window/notchWindow';
import { setPeekState } from '../ipc/mouse';

/** Référence opaque vers le listener actif (pour pouvoir le kill au quit). */
let listener: { kill: () => void } | null = null;

/**
 * Mode courant du notch — maintenu via `setNotchMode`. Conservé même
 * si on n'utilise plus Esc-block ici : utile pour de futures features
 * conditionnelles au mode (toasts qui ne push que si collapsed, etc.).
 */
let currentMode: NotchMode = 'collapsed';

/** Met à jour le mode courant. Appelé depuis globalShortcuts.ts. */
export function setNotchMode(mode: NotchMode): void {
  currentMode = mode;
  void currentMode;
}

/**
 * Notifie main + renderer du changement d'état Peek.
 *  - `setPeekState` reconfigure setIgnoreMouseEvents côté fenêtre
 *  - Le push IPC permet au renderer d'appliquer la classe CSS `.is-peeking`
 */
function emitPeek(on: boolean): void {
  setPeekState(on);
  const win = getNotchWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannel.PeekChange, on);
  }
}

/**
 * Démarre l'écoute globale du clavier. Import dynamique pour tolérer
 * l'absence du package (ex. lors d'un build CI multi-plateforme).
 *
 * Filtre uniquement Alt — toutes les autres touches sont ignorées pour
 * minimiser l'overhead.
 */
export async function startAltPeekListener(): Promise<void> {
  try {
    const mod = await import('node-global-key-listener');
    const { GlobalKeyboardListener } = mod;
    const gkl = new GlobalKeyboardListener();
    gkl.addListener((event) => {
      // Alt → mode Peek (continu, basé sur DOWN/UP). On NE consomme PAS
      // Alt — d'autres apps en ont besoin (Alt+Tab, raccourcis menu).
      if (event.name === 'LEFT ALT' || event.name === 'RIGHT ALT') {
        if (event.state === 'DOWN') emitPeek(true);
        else if (event.state === 'UP') emitPeek(false);
      }
      return false;
    });
    listener = { kill: () => gkl.kill() };
  } catch (err) {
    console.warn('[WinNotch] Global key listener indisponible:', err);
  }
}

/** Arrête le keyserver. Appelé à la fermeture de l'app. */
export function stopAltPeekListener(): void {
  try {
    listener?.kill();
  } catch {
    // Le keyserver peut déjà être mort (crash, signal externe) — sans effet.
  }
  listener = null;
}
