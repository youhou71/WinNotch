/**
 * Façade IPC du module Music.
 *
 * Centralise :
 *  - les 4 handlers `invoke` (get state, play/pause, next, previous)
 *  - le monitor SMTC qui push les changements en event-driven (pas de polling)
 *
 * La détection des seeks / dérives vit dans le WORKER (smtcWorker.ts,
 * tick 1 s qui n'envoie que sur changement réel) — l'ancien tick 1 s de
 * ce service ne faisait que relire le cache déjà alimenté par les push du
 * worker : purement redondant, supprimé à l'audit perf P10.
 *
 * Le contrôle se fait via les touches média virtuelles (cf. mediaKeys.ts),
 * pas via l'API SMTC qui est read-only dans ce package.
 */
import { ipcMain } from 'electron';
import { IpcChannel, type MusicState } from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import {
  initSmtcMonitor,
  disposeSmtcMonitor,
  readMusicState,
  EMPTY_MUSIC_STATE,
} from './smtc';
import { sendPlayPause, sendNext, sendPrevious } from './mediaKeys';

/**
 * Seuil (s) au-delà duquel un écart entre position observée et position
 * extrapolée depuis l'anchor est considéré comme un seek manuel et
 * déclenche un re-broadcast pour resynchroniser le renderer.
 */
const SEEK_THRESHOLD_SEC = 2;

let cached: MusicState = EMPTY_MUSIC_STATE;

/** Push asynchrone d'un MusicState au renderer. */
function broadcast(state: MusicState): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.MusicChange, state);
}

/**
 * Position attendue actuellement d'après l'anchor caché.
 * Sert à détecter un seek manuel : si la position lue par SMTC s'écarte
 * trop de cette extrapolation, c'est qu'un saut s'est produit.
 */
function expectedPosition(): number {
  if (!cached.playing || cached.updatedAt === 0) return cached.position;
  return cached.position + (Date.now() - cached.updatedAt) / 1000;
}

/**
 * Met à jour le cache et n'émet que si quelque chose a changé pour le
 * rendu visuel. La progression de la lecture *normale* (position qui
 * avance) n'est PAS un changement à broadcaster : le renderer interpole
 * lui-même via rAF à partir de l'anchor courant. On ne re-push qu'en
 * cas de changement de piste, play/pause, seek manuel, ou durée différente.
 */
function update(next: MusicState): void {
  const changed =
    next.title !== cached.title ||
    next.playing !== cached.playing ||
    next.source !== cached.source ||
    next.duration !== cached.duration ||
    Math.abs(next.position - expectedPosition()) > SEEK_THRESHOLD_SEC;
  cached = next;
  if (changed) broadcast(next);
}

/**
 * Enregistre les 4 handlers IPC + démarre SMTC. La détection seek/dérive
 * est portée par le tick du worker.
 */
export function registerMusicIpc(): void {
  // Démarrage du monitor SMTC. Le callback met à jour le cache et push
  // si nécessaire.
  initSmtcMonitor((state) => {
    update(state);
  });

  ipcMain.handle(IpcChannel.MusicGetState, async () => {
    return readMusicState();
  });

  // Les handlers de contrôle envoient la touche puis renvoient l'état
  // *avant* propagation SMTC (qui arrivera ~200 ms plus tard via push).
  // Ça permet à l'UI optimiste d'avoir une réponse rapide ; la valeur
  // sera réconciliée par le prochain event SMTC.
  ipcMain.handle(IpcChannel.MusicPlayPause, async () => {
    await sendPlayPause();
    return cached;
  });
  ipcMain.handle(IpcChannel.MusicNext, async () => {
    await sendNext();
    return cached;
  });
  ipcMain.handle(IpcChannel.MusicPrevious, async () => {
    await sendPrevious();
    return cached;
  });
}

/** Démonte le monitor SMTC. */
export function stopMusic(): void {
  disposeSmtcMonitor();
}
