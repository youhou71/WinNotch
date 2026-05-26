/**
 * Pilote du worker SMTC.
 *
 * Le module natif `@coooookies/windows-smtc-monitor` peut crasher
 * nativement (access violation C++) sur certaines machines, ce qui tuerait
 * l'entier main process. On l'exécute donc dans un **utility process**
 * Electron isolé (cf. smtcWorker.ts).
 *
 * Cette façade reste compatible avec le contrat précédent :
 *  - `initSmtcMonitor(onChange)` : démarre le worker et propage les events
 *  - `readMusicState()` : snapshot synchrone du dernier état reçu (cache)
 *  - `disposeSmtcMonitor()` : tue le worker au quit
 *
 * En cas de crash du worker (`exit` avec code ≠ 0), le module se
 * désactive : `readMusicState` renvoie l'état vide et `initSmtcMonitor`
 * ne tente pas de respawn (évite une boucle de crash).
 */
import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import type { MusicState } from '../../../shared/types';

export const EMPTY_MUSIC_STATE: MusicState = {
  playing: false,
  title: '',
  artist: '',
  album: '',
  source: '',
  thumbnail: null,
  position: 0,
  duration: 0,
  updatedAt: 0,
};

let workerProcess: UtilityProcess | null = null;
let workerDisabled = false;
/** Dernier MusicState reçu du worker. Sert de cache pour `readMusicState`. */
let lastState: MusicState = EMPTY_MUSIC_STATE;
let pushHandler: ((state: MusicState) => void) | null = null;

/** Résout le chemin du smtcWorker bundle compilé. */
function resolveWorkerPath(): string {
  // electron-vite émet `out/main/smtcWorker.js` à côté de `index.js`.
  if (is.dev) {
    return join(__dirname, 'smtcWorker.js');
  }
  return join(__dirname, 'smtcWorker.js');
}

/**
 * Type-guard rapide pour les messages reçus du worker.
 * Tous nos messages ont un champ `type` string.
 */
function isWorkerMessage(m: unknown): m is { type: string; [k: string]: unknown } {
  return typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string';
}

/**
 * Snapshot synchrone du dernier état reçu. Le worker pousse les
 * changements en push asynchrone — il n'y a pas d'appel bloquant.
 */
export function readMusicState(): MusicState {
  return lastState;
}

/**
 * Démarre le worker SMTC. Appelle `onChange` à chaque nouvel état reçu.
 * Tolère un échec total du worker (module manquant, segfault à l'init)
 * — dans ce cas le module reste en état vide indéfiniment.
 */
export function initSmtcMonitor(onChange: (state: MusicState) => void): void {
  if (workerDisabled) return;
  pushHandler = onChange;

  try {
    const workerPath = resolveWorkerPath();
    console.log('[music/smtc] fork utility process:', workerPath);

    const proc = utilityProcess.fork(workerPath, [], {
      serviceName: 'WinNotch-SMTC',
      stdio: 'pipe',
    });
    workerProcess = proc;

    // Forward stdout/stderr du worker dans la console du main pour
    // garder les logs unifiés (utile en dev).
    proc.stdout?.on('data', (b: Buffer) => process.stdout.write(b));
    proc.stderr?.on('data', (b: Buffer) => process.stderr.write(b));

    proc.on('message', (msg: unknown) => {
      if (!isWorkerMessage(msg)) return;
      switch (msg.type) {
        case 'state': {
          const state = msg.state as MusicState | undefined;
          if (state) {
            lastState = state;
            pushHandler?.(state);
          }
          break;
        }
        case 'log':
          console.log('[smtcWorker]', msg.message);
          break;
        case 'error':
          console.warn('[smtcWorker error]', msg.stage, msg.message);
          break;
        case 'fatal':
          console.error('[smtcWorker FATAL]', msg.message);
          workerDisabled = true;
          break;
        case 'ready':
          console.log('[music/smtc] worker prêt');
          break;
      }
    });

    proc.on('exit', (code: number) => {
      console.warn(`[music/smtc] worker exit code=${code} — module désactivé`);
      workerProcess = null;
      // Crash non-nominal → on désactive plutôt que de respawn pour
      // éviter une boucle infinie.
      if (code !== 0) {
        workerDisabled = true;
        lastState = EMPTY_MUSIC_STATE;
        pushHandler?.(EMPTY_MUSIC_STATE);
      }
    });
  } catch (err) {
    console.warn('[music/smtc] fork du worker a échoué:', err);
    workerDisabled = true;
  }
}

/** Tue le worker proprement (demande de shutdown + kill au cas où). */
export function disposeSmtcMonitor(): void {
  if (!workerProcess) return;
  try {
    workerProcess.postMessage({ type: 'shutdown' });
  } catch { /* ignore */ }
  try {
    workerProcess.kill();
  } catch { /* ignore */ }
  workerProcess = null;
}
