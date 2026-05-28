/**
 * Service du module VPN status.
 *
 * Responsabilités :
 *  - Polling PowerShell toutes les `pollSec` secondes (défaut 10).
 *  - Maintien d'une table interne `connectedSince` indexée par
 *    `interfaceName` pour fournir une durée de session stable même
 *    entre deux ticks.
 *  - Lookup pays asynchrone (best-effort, désactivable par config).
 *  - Broadcast IPC `vpn:change` à chaque transition d'état.
 *  - Handler `vpn:getState` / `vpn:refresh`.
 *
 * Flag d'arrêt : `WINNOTCH_DISABLE_VPN=1` saute l'enregistrement.
 *
 * Aucune action n'est exposée (read-only) — la conception délibérée
 * évite d'avoir à gérer l'élévation, les API propriétaires de chaque
 * client, et le risque de couper une session active par accident.
 */
import { ipcMain } from 'electron';
import Store from 'electron-store';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type Settings,
  type VpnConnection,
  type VpnState,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { buildConnections, runDetectScript, toVpnConnection } from './vpnDetector';
import { lookupCountry } from './countryLookup';

const MIN_POLL_SEC = 5;

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

let currentState: VpnState = {
  connected: false,
  connections: [],
  lastCheckAt: 0,
  lastError: null,
};

/**
 * Table interne pour stabiliser `connectedSince` :
 *  - `since` : Unix ms du passage `disconnected → connected` détecté
 *  - `isApprox` : true si l'interface était déjà active au démarrage
 *    de WinNotch (auquel cas la durée affichée serait fausse).
 */
const sessionTable = new Map<string, { since: number; isApprox: boolean }>();

let pollTimer: NodeJS.Timeout | null = null;
let tickInFlight: Promise<VpnState> | null = null;
let bootCompleted = false;

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.VpnChange, currentState);
}

/**
 * Met à jour `sessionTable` :
 *  - Une nouvelle interface VPN apparue depuis le dernier tick reçoit
 *    `since = now` (ou la valeur stockée si elle existait déjà).
 *  - Les interfaces qui ne sont plus actives sont purgées.
 *  - Au tout premier tick après le boot de WinNotch, on marque toutes
 *    les sessions trouvées comme « approximatives » pour éviter
 *    d'afficher une durée trompeuse.
 */
function reconcileSessions(activeKeys: string[], now: number): void {
  const active = new Set(activeKeys);
  for (const key of activeKeys) {
    if (!sessionTable.has(key)) {
      sessionTable.set(key, { since: now, isApprox: !bootCompleted });
    }
  }
  for (const key of [...sessionTable.keys()]) {
    if (!active.has(key)) sessionTable.delete(key);
  }
}

/** Lance les résolutions pays en arrière-plan et patche le state au retour. */
function scheduleCountryLookups(connections: VpnConnection[]): void {
  const lookupEnabled = store.get('moduleConfig').vpn.lookupCountry;
  if (!lookupEnabled) return;

  for (const conn of connections) {
    if (!conn.serverAddress || conn.country) continue;
    void lookupCountry(conn.serverAddress).then((country) => {
      if (!country) return;
      const idx = currentState.connections.findIndex(
        (c) => c.interfaceName === conn.interfaceName,
      );
      if (idx < 0) return;
      // Le state a pu être remplacé entretemps ; on patche si la connexion
      // est toujours là et n'a pas déjà un country (évite de re-broadcast
      // à chaque tick).
      const target = currentState.connections[idx];
      if (target.country) return;
      const updated: VpnConnection = { ...target, country };
      currentState = {
        ...currentState,
        connections: currentState.connections.map((c, i) => (i === idx ? updated : c)),
      };
      broadcast();
    });
  }
}

async function refreshOnce(): Promise<VpnState> {
  if (tickInFlight) return tickInFlight;
  const task = (async () => {
    const { snapshot, error } = await runDetectScript();
    const now = Date.now();
    if (!snapshot) {
      console.warn('[vpn] détection échouée:', error);
      currentState = {
        connected: currentState.connected,
        connections: currentState.connections,
        lastCheckAt: now,
        lastError: error,
      };
      broadcast();
      return currentState;
    }

    const raws = buildConnections(snapshot);
    const keys = raws.map((r) => r.interfaceName.toLowerCase());
    reconcileSessions(keys, now);
    bootCompleted = true;

    const connections: VpnConnection[] = raws.map((r) => {
      const sess = sessionTable.get(r.interfaceName.toLowerCase()) ?? {
        since: now,
        isApprox: true,
      };
      // Préserve un éventuel `country` déjà résolu sur cette interface.
      const previous = currentState.connections.find(
        (c) => c.interfaceName === r.interfaceName,
      );
      return toVpnConnection(r, sess.since, sess.isApprox, previous?.country);
    });

    currentState = {
      connected: connections.length > 0,
      connections,
      lastCheckAt: now,
      lastError: null,
    };
    broadcast();
    scheduleCountryLookups(connections);
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
  const cfg = store.get('moduleConfig').vpn;
  const sec = Math.max(MIN_POLL_SEC, cfg.pollSec || 10);
  pollTimer = setInterval(() => {
    void refreshOnce();
  }, sec * 1000);
}

/** Restart du timer si l'utilisateur change `pollSec`. */
function subscribeConfigChanges(): void {
  store.onDidChange('moduleConfig', (newVal, oldVal) => {
    const n = newVal?.vpn;
    const o = oldVal?.vpn;
    if (!n || !o) return;
    if (n.pollSec !== o.pollSec) restartPolling();
  });
}

export function registerVpnIpc(): void {
  ipcMain.handle(IpcChannel.VpnGetState, () => currentState);
  ipcMain.handle(IpcChannel.VpnRefresh, () => refreshOnce());

  subscribeConfigChanges();

  void refreshOnce();
  restartPolling();
}

export function stopVpn(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
