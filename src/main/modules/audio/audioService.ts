/**
 * Façade IPC du module Audio.
 *
 * Centralise :
 *  - les 4 handlers `invoke` consommés par le renderer (get/set volume,
 *    set muted, set device)
 *  - un polling toutes les 2 s pour détecter les changements externes
 *    (touches Volume Windows, sleep, branchement d'un casque, etc.)
 *  - un push événementiel `audio:change` quand l'état diffère du cache
 *
 * L'état est mis en cache pour pouvoir réagir gracieusement aux échecs
 * partiels : si une seule des trois sources (volume / muted / devices)
 * échoue à un cycle, on conserve la dernière valeur connue pour les autres.
 */
import { ipcMain } from 'electron';
import { IpcChannel, type AudioState } from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { getVolume, setVolume, getMuted, setMuted } from './volume';
import { listOutputDevices, setDefaultOutput } from './devices';

/**
 * Intervalle du polling. 2 s est un compromis entre réactivité (l'utilisateur
 * voit son volume bouger après avoir appuyé sur les touches média) et coût
 * (chaque cycle spawne 2 child_process : loudness + SVV).
 */
const POLL_INTERVAL_MS = 2000;

/** Dernier état connu — sert de fallback en cas d'échec partiel. */
let cached: AudioState = {
  level: 0,
  muted: false,
  devices: [],
  currentDeviceId: null,
};

let pollTimer: NodeJS.Timeout | null = null;

/**
 * Lit l'état audio complet en parallèle. `Promise.allSettled` garantit
 * qu'une erreur sur une source n'empêche pas les autres de retourner
 * leur valeur (ex. SVV peut être en circuit-breaker pendant que loudness
 * fonctionne très bien).
 */
async function readState(): Promise<AudioState> {
  const results = await Promise.allSettled([
    getVolume(),
    getMuted(),
    listOutputDevices(),
  ]);
  const [volRes, mutedRes, devRes] = results;
  if (volRes.status === 'rejected') console.error('[audio] getVolume rejected:', volRes.reason);
  if (mutedRes.status === 'rejected') console.error('[audio] getMuted rejected:', mutedRes.reason);
  if (devRes.status === 'rejected') console.error('[audio] listOutputDevices rejected:', devRes.reason);
  const level = volRes.status === 'fulfilled' ? volRes.value : cached.level;
  const muted = mutedRes.status === 'fulfilled' ? mutedRes.value : cached.muted;
  const devices = devRes.status === 'fulfilled' ? devRes.value : cached.devices;
  const current = devices.find((d) => d.isDefault) ?? null;
  return {
    level,
    muted,
    devices,
    currentDeviceId: current?.id ?? null,
  };
}

/** Push asynchrone d'un AudioState au renderer (canal `audio:change`). */
function broadcast(state: AudioState): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.AudioChange, state);
}

/**
 * Lit le nouvel état, met à jour le cache, et émet `audio:change` si quelque
 * chose a changé. Comparaison "shallow" suffisante pour notre cas (devices
 * comparés par longueur ; un swap simultané de deux devices serait raté
 * mais reste improbable).
 */
async function refresh(): Promise<AudioState> {
  const next = await readState();
  const changed =
    next.level !== cached.level ||
    next.muted !== cached.muted ||
    next.currentDeviceId !== cached.currentDeviceId ||
    next.devices.length !== cached.devices.length;
  cached = next;
  if (changed) broadcast(next);
  return next;
}

/**
 * Enregistre les 4 handlers `invoke` du module Audio.
 *
 * Chaque setter retourne le nouvel état après application : le renderer
 * peut donc faire une mise à jour optimiste puis réconcilier avec la
 * réponse, sans attendre le prochain polling.
 */
export function registerAudioIpc(): void {
  ipcMain.handle(IpcChannel.AudioGetState, async () => {
    return refresh();
  });

  ipcMain.handle(IpcChannel.AudioSetVolume, async (_e, level: number) => {
    await setVolume(level);
    return refresh();
  });

  ipcMain.handle(IpcChannel.AudioSetMuted, async (_e, muted: boolean) => {
    await setMuted(muted);
    return refresh();
  });

  ipcMain.handle(IpcChannel.AudioSetDevice, async (_e, id: string) => {
    await setDefaultOutput(id);
    return refresh();
  });
}

/** Démarre le polling 2 s. Idempotent. */
export function startAudioPolling(): void {
  if (pollTimer) return;
  void refresh();
  pollTimer = setInterval(() => {
    void refresh();
  }, POLL_INTERVAL_MS);
}

/** Arrête le polling. Appelé à la fermeture de l'app. */
export function stopAudioPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
