/**
 * Service du module VPN status.
 *
 * Responsabilités :
 *  - Détection pilotée par les changements d'interfaces réseau : à chaque
 *    tick (`pollMs`, défaut 10 000 ms) on compare une SIGNATURE de
 *    `os.networkInterfaces()` (pur Node, quasi gratuit) — le script
 *    PowerShell (3 requêtes WMI/CIM) ne tourne que si la signature a
 *    changé (connexion/déconnexion VPN = apparition/disparition d'une
 *    interface ou d'une adresse) ou au plus toutes les 60 s en
 *    réconciliation lente (audit perf P7 — avant : 3 requêtes WMI toutes
 *    les 10 s en continu).
 *  - Maintien d'une table interne `connectedSince` indexée par
 *    `interfaceName` pour fournir une durée de session stable même
 *    entre deux ticks.
 *  - Lookup pays asynchrone (best-effort, désactivable par config).
 *  - Broadcast IPC `vpn:change` à chaque transition d'état.
 *  - Handler `vpn:getState` / `vpn:refresh` (refresh manuel = détection
 *    complète forcée, sans heuristique).
 *
 * Flag d'arrêt : `WINNOTCH_DISABLE_VPN=1` saute l'enregistrement.
 *
 * Aucune action n'est exposée (read-only) — la conception délibérée
 * évite d'avoir à gérer l'élévation, les API propriétaires de chaque
 * client, et le risque de couper une session active par accident.
 */
import { ipcMain } from 'electron';
import os from 'node:os';
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

const MIN_POLL_MS = 5_000;

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

/** Intervalle max entre deux détections PowerShell complètes. */
const FULL_DETECT_INTERVAL_MS = 60_000;
let lastDetectAt = 0;
let lastIfaceSignature = '';

/**
 * Signature compacte des interfaces réseau visibles par Node. Toute
 * connexion/déconnexion VPN fait apparaître/disparaître une interface ou
 * une adresse → la signature change → on déclenche la détection complète.
 */
function networkSignature(): string {
  const ifaces = os.networkInterfaces();
  const parts: string[] = [];
  for (const name of Object.keys(ifaces).sort()) {
    const addrs = (ifaces[name] ?? []).map((a) => a.address).sort();
    parts.push(`${name}=${addrs.join(',')}`);
  }
  return parts.join(';');
}

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

/**
 * Tick périodique : ne lance la détection PowerShell que si les interfaces
 * réseau ont bougé depuis le dernier passage, ou si la dernière détection
 * complète date de plus de `FULL_DETECT_INTERVAL_MS` (réconciliation lente
 * — filet pour les états que `os.networkInterfaces()` ne reflète pas).
 */
async function pollTick(): Promise<void> {
  const sig = networkSignature();
  const now = Date.now();
  if (sig === lastIfaceSignature && now - lastDetectAt < FULL_DETECT_INTERVAL_MS) {
    return;
  }
  lastIfaceSignature = sig;
  await refreshOnce();
}

async function refreshOnce(): Promise<VpnState> {
  if (tickInFlight) return tickInFlight;
  const task = (async () => {
    lastDetectAt = Date.now();
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
  const ms = Math.max(MIN_POLL_MS, cfg.pollMs || 10_000);
  pollTimer = setInterval(() => {
    void pollTick();
  }, ms);
}

/** Restart du timer si l'utilisateur change `pollMs`. */
function subscribeConfigChanges(): void {
  store.onDidChange('moduleConfig', (newVal, oldVal) => {
    const n = newVal?.vpn;
    const o = oldVal?.vpn;
    if (!n || !o) return;
    if (n.pollMs !== o.pollMs) restartPolling();
  });
}

export function registerVpnIpc(): void {
  ipcMain.handle(IpcChannel.VpnGetState, () => currentState);
  ipcMain.handle(IpcChannel.VpnRefresh, () => refreshOnce());

  subscribeConfigChanges();

  // Baseline de la signature AVANT la première détection, sinon le premier
  // pollTick relancerait une détection complète redondante.
  lastIfaceSignature = networkSignature();
  void refreshOnce();
  restartPolling();
}

export function stopVpn(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
