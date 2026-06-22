/**
 * Service du module `claude.usage` — suivi des limites Claude Pro / Max.
 *
 * Stratégie de lecture, à chaque tick :
 *  1. Tente de lire `~/.claude/winnotch-usage.json` (alimenté par le
 *     wrapper statusline WinNotch). Si présent et frais → source
 *     autoritaire, `source = 'statusline'`.
 *  2. Sinon → fallback `jsonlParser` qui estime grossièrement les
 *     pourcentages en comptant les events `assistant` dans les fenêtres
 *     glissantes. `source = 'estimated'`.
 *
 * Persistance :
 *  - Le ring buffer `sparkline` (288 points = 24 h à 5 min) est stocké
 *    dans `electron-store` (`claudeUsageSparkline`) pour survivre aux
 *    redémarrages. On push un nouveau point seulement quand on franchit
 *    une borne de 5 min, pour ne pas saturer.
 *
 * Flag d'arrêt : `WINNOTCH_DISABLE_CLAUDE_USAGE=1` saute l'enregistrement.
 */
import { ipcMain } from 'electron';
import Store from 'electron-store';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type ClaudeUsageState,
  type ClaudeUsageWindow,
  type Settings,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { readStatuslineCache } from './statuslineReader';
import { estimateUsageFromJsonl } from './jsonlParser';
import { projectWindow } from './projection';
import {
  installStatusline,
  isClaudeInstalled,
  isStatuslineInstalled,
  refreshWrapperIfInstalled,
  uninstallStatusline,
} from './statuslineInstaller';

const CACHE_FILE_NAME = 'winnotch-usage.json';
const CLAUDE_DIR = path.join(os.homedir(), '.claude');

const MIN_POLL_MS = 10_000;
const MAX_POLL_MS = 300_000;
const SPARKLINE_SIZE = 288; // 24 h × 12 points/h
const SPARK_BUCKET_MS = 5 * 60 * 1000; // 5 min
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Âge max accepté pour le cache statusline. Volontairement très large :
 * la péremption logique d'une valeur d'usage est portée par son champ
 * `resetsAt` (cf. statuslineReader). On accepte donc des caches anciens
 * tant que leur fenêtre de reset n'est pas dépassée — la conso ne peut
 * que monter entre deux turns Claude. 7 jours = durée max de la fenêtre
 * weekly, au-delà c'est forcément périmé.
 */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Extension de schéma electron-store : on stocke le ring buffer
 * sparkline + le timestamp du dernier push hors du `config.json` géré
 * par `settingsService` (pour éviter de polluer le store des Settings
 * utilisateur avec un buffer technique).
 */
interface ClaudeUsageStore {
  claudeUsageSparkline?: number[];
  /**
   * Ring buffer parallèle du `percent` hebdomadaire (même cadence 5 min).
   * Sert uniquement au calcul de vélocité/projection de la fenêtre 7 j
   * (non exposé au renderer — la card n'affiche que la sparkline 5 h).
   */
  claudeUsageSparklineWeekly?: number[];
  claudeUsageLastSparkAt?: number;
  /**
   * Numéro de version interne du ring buffer sparkline. Incrémenté à chaque
   * fois qu'un fix change la sémantique des valeurs stockées et nécessite
   * une purge. Sans ce flag, l'utilisateur traînerait à vie des valeurs
   * polluées par les bugs des versions précédentes.
   *
   *  - v1 (initial) : valeurs jsonlParser pré-fix `end_turn` — pouvait
   *    saturer à 100 % à cause du comptage de chaque chunk `assistant`.
   *  - v2 : valeurs filtrées sur `stop_reason === 'end_turn'`, cohérentes.
   */
  claudeUsageSparkVersion?: number;
}

const SPARKLINE_DATA_VERSION = 2;

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

const auxStore = new Store<ClaudeUsageStore>({
  name: 'claude-usage',
  defaults: {
    claudeUsageSparkline: new Array(SPARKLINE_SIZE).fill(0),
    claudeUsageSparklineWeekly: new Array(SPARKLINE_SIZE).fill(0),
    claudeUsageLastSparkAt: 0,
    claudeUsageSparkVersion: SPARKLINE_DATA_VERSION,
  },
});

/**
 * Migration du ring buffer : si la version stockée est plus ancienne que
 * `SPARKLINE_DATA_VERSION`, on purge les anciens points (potentiellement
 * pollués par un bug de comptage précédent) et on enregistre la nouvelle
 * version. Idempotent : à la 2ᵉ passe le flag est déjà à jour, no-op.
 */
function migrateSparklineIfNeeded(): void {
  const storedVersion = auxStore.get('claudeUsageSparkVersion') ?? 0;
  if (storedVersion >= SPARKLINE_DATA_VERSION) return;
  auxStore.set('claudeUsageSparkline', new Array(SPARKLINE_SIZE).fill(0));
  auxStore.set('claudeUsageSparklineWeekly', new Array(SPARKLINE_SIZE).fill(0));
  auxStore.set('claudeUsageLastSparkAt', 0);
  auxStore.set('claudeUsageSparkVersion', SPARKLINE_DATA_VERSION);
  console.log(
    `[claudeUsage] migration sparkline v${storedVersion} → v${SPARKLINE_DATA_VERSION} : ring buffers purgés`,
  );
}

migrateSparklineIfNeeded();

/**
 * Buffer hebdo en mémoire (miroir persisté dans `auxStore`). Tenu hors du
 * `ClaudeUsageState` car le renderer n'en a pas besoin (seule la projection
 * dérivée lui est poussée). Initialisé APRÈS la migration (qui peut le purger).
 */
let weeklySpark: number[] = normaliseSparkline(
  auxStore.get('claudeUsageSparklineWeekly') ?? new Array(SPARKLINE_SIZE).fill(0),
);

function emptyState(): ClaudeUsageState {
  const now = Date.now();
  const sparkline =
    auxStore.get('claudeUsageSparkline') ??
    new Array(SPARKLINE_SIZE).fill(0);
  return {
    fiveH: { percent: 0, resetsAt: now + FIVE_HOURS_MS, source: 'estimated' },
    weekly: { percent: 0, resetsAt: now + SEVEN_DAYS_MS, source: 'estimated' },
    sparkline: normaliseSparkline(sparkline),
    projection: {
      fiveH: { velocityPctPerHour: 0, exhaustAt: null },
      weekly: { velocityPctPerHour: 0, exhaustAt: null },
    },
    plan: 'unknown',
    statuslineInstalled: false,
    claudeInstalled: false,
    lastSyncAt: 0,
    lastError: null,
  };
}

let currentState: ClaudeUsageState = emptyState();
let pollTimer: NodeJS.Timeout | null = null;
let tickInFlight: Promise<void> | null = null;
let cacheWatcher: FSWatcher | null = null;
/**
 * Anti-rebond : `fs.watch` peut émettre plusieurs events `change` rapprochés
 * pour une même écriture atomique (tmp + rename). On déclenche un tick au
 * plus toutes les 500 ms.
 */
let lastWatchTickAt = 0;

function normaliseSparkline(arr: number[]): number[] {
  const out = Array.isArray(arr) ? arr.slice(-SPARKLINE_SIZE) : [];
  while (out.length < SPARKLINE_SIZE) out.unshift(0);
  return out.map((v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0));
}

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.ClaudeUsageChange, currentState);
}

/** Pousse une valeur en fin de ring buffer (taille fixe SPARKLINE_SIZE). */
function pushPoint(buffer: number[], value: number): number[] {
  const next = buffer.slice(1);
  next.push(value);
  while (next.length < SPARKLINE_SIZE) next.unshift(0);
  while (next.length > SPARKLINE_SIZE) next.shift();
  return next;
}

/**
 * Pousse les DEUX ring buffers (5 h + 7 j) si la borne de 5 min est
 * franchie. Met à jour `weeklySpark` (effet de bord) et retourne le buffer
 * 5 h (exposé dans le state). Cadence partagée → un seul `lastSparkAt`.
 */
function pushSparklineIfDue(percent5h: number, percent7d: number): number[] {
  const now = Date.now();
  const lastAt = auxStore.get('claudeUsageLastSparkAt') ?? 0;
  if (now - lastAt < SPARK_BUCKET_MS) return currentState.sparkline;

  const next5 = pushPoint(currentState.sparkline, percent5h);
  weeklySpark = pushPoint(weeklySpark, percent7d);

  auxStore.set('claudeUsageSparkline', next5);
  auxStore.set('claudeUsageSparklineWeekly', weeklySpark);
  auxStore.set('claudeUsageLastSparkAt', now);
  return next5;
}

async function tick(): Promise<void> {
  if (tickInFlight) return tickInFlight;
  const task = (async () => {
    const cfg = store.get('moduleConfig')['claude.usage'];
    const claudeInstalled = await isClaudeInstalled();
    const statuslineInstalled = claudeInstalled
      ? await isStatuslineInstalled()
      : false;

    let lastError: string | null = null;
    let fiveH: ClaudeUsageWindow = currentState.fiveH;
    let weekly: ClaudeUsageWindow = currentState.weekly;

    if (claudeInstalled) {
      const cache = await readStatuslineCache(CACHE_MAX_AGE_MS);
      const now = Date.now();
      if (cache) {
        if (cache.fiveH) {
          // Si la fenêtre a déjà reset depuis la capture, on remet à 0%
          // et on programme le prochain reset à +5h (rolling). Sinon on
          // garde la valeur précise du cache.
          if (cache.fiveH.resetsAt <= now) {
            fiveH = { percent: 0, resetsAt: now + FIVE_HOURS_MS, source: 'statusline' };
          } else {
            fiveH = {
              percent: cache.fiveH.percent,
              resetsAt: cache.fiveH.resetsAt,
              source: 'statusline',
            };
          }
        }
        if (cache.weekly) {
          if (cache.weekly.resetsAt <= now) {
            weekly = { percent: 0, resetsAt: now + SEVEN_DAYS_MS, source: 'statusline' };
          } else {
            weekly = {
              percent: cache.weekly.percent,
              resetsAt: cache.weekly.resetsAt,
              source: 'statusline',
            };
          }
        }
      } else {
        // Fallback : estimation .jsonl.
        try {
          const est = await estimateUsageFromJsonl(cfg.plan);
          const now = Date.now();
          fiveH = {
            percent: est.fiveH.percent,
            resetsAt: now + FIVE_HOURS_MS,
            source: 'estimated',
          };
          weekly = {
            percent: est.weekly.percent,
            resetsAt: now + SEVEN_DAYS_MS,
            source: 'estimated',
          };
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    const sparkline = pushSparklineIfDue(fiveH.percent, weekly.percent);

    const projNow = Date.now();
    const projection = {
      fiveH: projectWindow(
        fiveH.percent,
        fiveH.resetsAt,
        sparkline,
        projNow,
        SPARK_BUCKET_MS,
      ),
      weekly: projectWindow(
        weekly.percent,
        weekly.resetsAt,
        weeklySpark,
        projNow,
        SPARK_BUCKET_MS,
      ),
    };

    currentState = {
      fiveH,
      weekly,
      sparkline,
      projection,
      plan: cfg.plan,
      statuslineInstalled,
      claudeInstalled,
      lastSyncAt: Date.now(),
      lastError,
    };
    broadcast();
  })();
  tickInFlight = task;
  try {
    await task;
  } finally {
    tickInFlight = null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function restartPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const cfg = store.get('moduleConfig')['claude.usage'];
  const ms = clamp(cfg.pollMs ?? 30_000, MIN_POLL_MS, MAX_POLL_MS);
  pollTimer = setInterval(() => {
    void tick();
  }, ms);
}

/**
 * Surveille `~/.claude/` pour réagir immédiatement à chaque écriture du
 * fichier cache statusline. Sans ce watcher, l'utilisateur attendait
 * jusqu'à `pollMs` (par défaut 30 s) entre un turn Claude et la mise à
 * jour de la card — perçu comme un « bug de rechargement ».
 *
 * On surveille le dossier parent (qui existe dès que Claude Code est
 * installé) plutôt que le fichier directement (qui peut ne pas exister
 * tant que le wrapper n'a pas tourné une première fois). Le filtre sur
 * le nom évite les ticks parasites quand Claude Code écrit ses propres
 * fichiers dans le dossier.
 */
function startCacheWatcher(): void {
  stopCacheWatcher();
  try {
    cacheWatcher = watch(CLAUDE_DIR, { persistent: false }, (_event, filename) => {
      if (filename !== CACHE_FILE_NAME) return;
      const now = Date.now();
      if (now - lastWatchTickAt < 500) return;
      lastWatchTickAt = now;
      void tick();
    });
    cacheWatcher.on('error', (err) => {
      console.warn('[claudeUsage] cache watcher error (best-effort):', err);
    });
  } catch (err) {
    // ENOENT si ~/.claude/ n'existe pas → Claude Code pas installé,
    // on ne watch pas. Le polling reste actif comme filet.
    console.warn('[claudeUsage] cache watcher init échec (best-effort):', err);
  }
}

function stopCacheWatcher(): void {
  if (cacheWatcher) {
    try {
      cacheWatcher.close();
    } catch {
      // best-effort
    }
    cacheWatcher = null;
  }
}

function subscribeConfigChanges(): void {
  store.onDidChange('moduleConfig', (newVal, oldVal) => {
    const n = newVal?.['claude.usage'];
    const o = oldVal?.['claude.usage'];
    if (!n || !o) return;
    if (n.pollMs !== o.pollMs) restartPolling();
    // plan / thresholdsPct : pris en compte au tick suivant, pas besoin de
    // redémarrer le timer.
  });
}

export function registerClaudeUsageIpc(): void {
  if (process.env.WINNOTCH_DISABLE_CLAUDE_USAGE === '1') return;

  ipcMain.handle(IpcChannel.ClaudeUsageGetState, () => currentState);
  ipcMain.handle(IpcChannel.ClaudeUsageRefresh, async () => {
    await tick();
    return currentState;
  });
  ipcMain.handle(
    IpcChannel.ClaudeUsageInstallStatusline,
    async (_e, enable: boolean) => {
      const result = enable
        ? await installStatusline()
        : await uninstallStatusline();
      // Re-tick pour que `statuslineInstalled` reflète immédiatement le
      // changement côté UI sans attendre le prochain polling.
      await tick();
      return result;
    },
  );

  subscribeConfigChanges();
  // Propage les éventuelles évolutions du wrapper bundlé vers le fichier
  // copié dans userData. Indispensable pour qu'un user déjà migré
  // bénéficie des fixes du script sans réinstaller manuellement depuis
  // Settings.
  void refreshWrapperIfInstalled();
  startCacheWatcher();
  void tick();
  restartPolling();
}

export function stopClaudeUsage(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  stopCacheWatcher();
}
