/**
 * Implémentation **native** du détecteur (plein écran + Alt), en remplacement
 * du process `powershell.exe` résident.
 *
 * Elle reproduit exactement les cadences du script qu'elle remplace : lecture
 * d'Alt toutes les 75 ms avec émission **uniquement sur transition**, et
 * lecture de la fenêtre au premier plan un tick sur dix (750 ms).
 *
 * Le polling revient donc dans l'event loop du main process, alors que le
 * process PowerShell séparé l'en sortait — c'était le risque identifié au plan.
 * Il a été mesuré avant d'écrire ce module (`scripts/check-native-win32.cjs`) :
 * ~1 µs par appel, soit ~0,019 ms de CPU par seconde, 0,002 % d'un cœur. Le
 * repli `worker_thread` envisagé est donc inutile — et à comparer aux ~200 ms
 * qu'un seul `CreateProcess` coûte sur un poste avec EDR.
 *
 * Ce module ne décide rien et n'émet aucun IPC : il échantillonne le système et
 * appelle les callbacks fournis. L'interprétation vit dans `fullscreenLogic.ts`,
 * la diffusion dans `fullscreenDetector.ts`.
 */
import { isNativeWin32Available, isAltDown, readForegroundWindow } from '../../native/win32';
import type { ForegroundWindowInfo } from '../../native/win32';

/** Cadence de lecture d'Alt — latence imperceptible pour un effet d'opacité. */
const ALT_POLL_INTERVAL_MS = 75;
/** Cadence de lecture de la fenêtre au premier plan. */
const WINDOW_POLL_INTERVAL_MS = 750;

export interface NativeDetectorCallbacks {
  /** Appelé uniquement sur transition (enfoncé ↔ relâché). */
  onAltChange: (down: boolean) => void;
  /** Échantillon de fenêtre ; `null` si aucune fenêtre exploitable. */
  onWindowSample: (info: ForegroundWindowInfo | null) => void;
}

let timer: NodeJS.Timeout | null = null;
let altDown = false;
let tick = 0;

/**
 * Démarre le détecteur natif. Renvoie `false` si la couche native est
 * indisponible — l'appelant doit alors se replier sur PowerShell.
 *
 * `pollAlt` à `false` (aucun handler Alt enregistré, ex.
 * `WINNOTCH_DISABLE_ALT_PEEK=1`) fait tourner la boucle à la seule cadence
 * utile, 750 ms, au lieu de réveiller l'event loop 13 fois par seconde pour
 * rien — c'est l'équivalent de l'`AltIntervalMs = 0` du script PowerShell.
 */
export function startNativeDetector(
  callbacks: NativeDetectorCallbacks,
  pollAlt: boolean,
): boolean {
  if (timer) return true;
  if (!isNativeWin32Available()) return false;

  const intervalMs = pollAlt ? ALT_POLL_INTERVAL_MS : WINDOW_POLL_INTERVAL_MS;
  const windowEvery = Math.max(1, Math.round(WINDOW_POLL_INTERVAL_MS / intervalMs));

  altDown = false;
  tick = 0;

  timer = setInterval(() => {
    if (pollAlt) {
      const down = isAltDown();
      if (down !== altDown) {
        altDown = down;
        callbacks.onAltChange(down);
      }
    }
    if (tick % windowEvery === 0) {
      callbacks.onWindowSample(readForegroundWindow());
    }
    tick += 1;
  }, intervalMs);

  return true;
}

/**
 * Arrête le détecteur. Si Alt était considéré comme enfoncé, notifie le
 * relâchement : sans cela le notch resterait figé en mode Peek.
 */
export function stopNativeDetector(callbacks?: NativeDetectorCallbacks): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (altDown) {
    altDown = false;
    callbacks?.onAltChange(false);
  }
  tick = 0;
}

/** True si le détecteur natif est celui qui tourne actuellement. */
export function isNativeDetectorRunning(): boolean {
  return timer !== null;
}
