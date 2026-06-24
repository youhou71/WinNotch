/**
 * Service du module Confidentialité (témoin caméra / micro).
 *
 * Read-only, 100 % local : lit périodiquement le registre Windows
 * `CapabilityAccessManager` via le PowerShell résident pour savoir si une
 * app utilise ACTUELLEMENT la webcam ou le micro, et expose une pastille
 * d'état. Aucune action, aucun réseau, aucune donnée stockée.
 *
 * Flag d'arrêt : `WINNOTCH_DISABLE_PRIVACY=1` saute l'enregistrement.
 */
import { ipcMain } from 'electron';
import Store from 'electron-store';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type PrivacyState,
  type Settings,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { runPrivacyScript } from './privacyDetector';

const MIN_POLL_MS = 2_000;

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

let currentState: PrivacyState = {
  camActive: false,
  micActive: false,
  camApps: [],
  micApps: [],
  lastCheckAt: 0,
  lastError: null,
};

let pollTimer: NodeJS.Timeout | null = null;
let tickInFlight: Promise<PrivacyState> | null = null;

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.PrivacyChange, currentState);
}

async function refreshOnce(): Promise<PrivacyState> {
  if (tickInFlight) return tickInFlight;
  const task = (async () => {
    const { snapshot, error } = await runPrivacyScript();
    const now = Date.now();
    if (!snapshot) {
      // Échec : on garde l'ancien état (mieux qu'un faux "rien d'actif").
      currentState = { ...currentState, lastCheckAt: now, lastError: error };
      broadcast();
      return currentState;
    }
    currentState = {
      camActive: snapshot.cam.length > 0,
      micActive: snapshot.mic.length > 0,
      camApps: snapshot.cam,
      micApps: snapshot.mic,
      lastCheckAt: now,
      lastError: null,
    };
    broadcast();
    return currentState;
  })();
  tickInFlight = task;
  try {
    return await task;
  } finally {
    tickInFlight = null;
  }
}

function restartPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const cfg = store.get('moduleConfig').privacy;
  const ms = Math.max(MIN_POLL_MS, cfg.pollMs || 4_000);
  pollTimer = setInterval(() => {
    void refreshOnce();
  }, ms);
}

function subscribeConfigChanges(): void {
  store.onDidChange('moduleConfig', (newVal, oldVal) => {
    const n = newVal?.privacy;
    const o = oldVal?.privacy;
    if (!n || !o) return;
    if (n.pollMs !== o.pollMs) restartPolling();
  });
}

export function registerPrivacyIpc(): void {
  if (process.env.WINNOTCH_DISABLE_PRIVACY === '1') return;
  ipcMain.handle(IpcChannel.PrivacyGetState, () => currentState);
  ipcMain.handle(IpcChannel.PrivacyRefresh, () => refreshOnce());

  subscribeConfigChanges();
  void refreshOnce();
  restartPolling();
}

export function stopPrivacy(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
