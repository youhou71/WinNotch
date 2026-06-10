/**
 * Service du module System (CPU / RAM / Réseau live).
 *
 * Responsabilités :
 *  - Polling à `pollMs` (défaut 1 000 ms) : `os.cpus()` + `os.totalmem`
 *    en synchrone + `Get-NetAdapterStatistics` en async.
 *  - Maintien des deux snapshots précédents (CPU + réseau) pour le calcul
 *    différentiel.
 *  - Maintien d'un ring buffer de 60 points par métrique pour le sparkline.
 *  - Broadcast IPC `system:change` à chaque tick. Le payload est petit
 *    (~1 KB) et la fréquence est faible (1 Hz) → diffusion inconditionnelle,
 *    pas de coalescence.
 *  - Handler `system:getState` pour le retour synchrone au mount du Context.
 *
 * Flag d'arrêt : `WINNOTCH_DISABLE_SYSTEM=1` saute l'enregistrement.
 *
 * Aucune action exposée (read-only). Si la lecture réseau échoue
 * (PowerShell absent / timeout), CPU et RAM continuent à être publiés et
 * `lastError` porte le détail.
 */
import { ipcMain } from 'electron';
import Store from 'electron-store';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type Settings,
  type SystemState,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { isFullscreenActive } from '../shell/fullscreenDetector';
import { getNotchMode } from '../../shortcuts/altPeek';
import {
  cpuPercentBetween,
  netBytesPerSec,
  readCpuSnapshot,
  readMemory,
  readNetSnapshot,
  readUptimeSec,
  type NetSnapshot,
} from './metricsReader';

const MIN_POLL_MS = 500;
const MAX_POLL_MS = 5000;
const HISTORY_LENGTH = 60;

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

function emptyState(): SystemState {
  const zeros = new Array(HISTORY_LENGTH).fill(0);
  return {
    cpu: { value: 0, history: [...zeros] },
    ram: { value: 0, history: [...zeros], usedBytes: 0, totalBytes: 0 },
    net: { value: 0, history: [...zeros] },
    uptimeSec: 0,
    lastTickAt: 0,
    lastError: null,
  };
}

let currentState: SystemState = emptyState();
let prevCpu = readCpuSnapshot();
let prevNet: NetSnapshot | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let tickInFlight: Promise<void> | null = null;

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.SystemChange, currentState);
}

/** Ajoute un point au ring buffer en évinçant le plus ancien. */
function pushHistory(history: number[], value: number): number[] {
  const next = history.length >= HISTORY_LENGTH
    ? history.slice(1)
    : [...history];
  next.push(value);
  // Garantit la longueur exacte même si l'historique a été corrompu par une
  // sérialisation/désérialisation parasite (cas peu probable mais robuste).
  while (next.length < HISTORY_LENGTH) next.unshift(0);
  while (next.length > HISTORY_LENGTH) next.shift();
  return next;
}

async function tick(): Promise<void> {
  if (tickInFlight) return tickInFlight;
  const task = (async () => {
    const cfg = store.get('moduleConfig').system;

    // Notch invisible (app fullscreen + notch resté collapsed) : on saute
    // la requête WMI réseau ET le broadcast — ce travail n'alimenterait
    // qu'une UI à opacity 0 (audit perf P7). CPU/RAM restent lus (sync,
    // quasi gratuits) pour garder des sparklines continus au retour.
    // `prevNet = null` évite de calculer au retour un débit moyenné sur
    // toute la durée du masquage.
    const uiHidden = isFullscreenActive() && getNotchMode() === 'collapsed';

    // CPU (synchrone, pas chère)
    const currCpu = readCpuSnapshot();
    const cpuPct = cpuPercentBetween(prevCpu, currCpu);
    prevCpu = currCpu;

    // RAM (synchrone)
    const mem = readMemory();

    // Uptime
    const uptimeSec = readUptimeSec();

    // Réseau (async, PowerShell) — sauté quand l'UI est masquée.
    let netBps = 0;
    let netError: string | null = null;
    if (uiHidden) {
      prevNet = null;
    } else {
      try {
        const { snapshot, error } = await readNetSnapshot();
        if (snapshot) {
          netBps = netBytesPerSec(prevNet, snapshot, cfg.netInterfaces);
          prevNet = snapshot;
        } else {
          netError = error;
        }
      } catch (err) {
        netError = err instanceof Error ? err.message : String(err);
      }
    }

    currentState = {
      cpu: {
        value: cpuPct,
        history: pushHistory(currentState.cpu.history, cpuPct),
      },
      ram: {
        value: mem.percent,
        history: pushHistory(currentState.ram.history, mem.percent),
        usedBytes: mem.usedBytes,
        totalBytes: mem.totalBytes,
      },
      net: {
        value: netBps,
        history: pushHistory(currentState.net.history, netBps),
      },
      uptimeSec,
      lastTickAt: Date.now(),
      lastError: netError,
    };
    if (!uiHidden) broadcast();
  })();
  tickInFlight = task;
  try {
    await task;
  } finally {
    tickInFlight = null;
  }
}

function restartPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const cfg = store.get('moduleConfig').system;
  const ms = Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, cfg.pollMs || 1000));
  pollTimer = setInterval(() => {
    void tick();
  }, ms);
}

function subscribeConfigChanges(): void {
  store.onDidChange('moduleConfig', (newVal, oldVal) => {
    const n = newVal?.system;
    const o = oldVal?.system;
    if (!n || !o) return;
    if (n.pollMs !== o.pollMs) restartPolling();
  });
}

export function registerSystemIpc(): void {
  ipcMain.handle(IpcChannel.SystemGetState, () => currentState);

  subscribeConfigChanges();

  // Premier tick : initialise prevCpu/prevNet. Les valeurs CPU/NET
  // calculées seront ≈ 0 puisqu'il n'y a pas encore de delta — c'est
  // attendu. Le deuxième tick (au plus tard 1 s plus tard) donnera les
  // premiers vrais points.
  void tick();
  restartPolling();
}

export function stopSystem(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
