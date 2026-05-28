/**
 * Service central du module Claude Code.
 *
 * Responsabilités :
 *  - Scan initial de `~/.claude/projects/* /*.jsonl`
 *  - Watcher de fichiers via polling natif Node (`fs.stat` + comparaison
 *    mtime/size) — bien plus fiable que chokidar sur Windows pour les
 *    `.jsonl` Claude qui peuvent atteindre plusieurs MB.
 *  - Tick périodique court (500 ms) pour capter les changements rapides
 *    type `AskUserQuestion` qui ne dure parfois que ~1 s avant la
 *    réponse de l'utilisateur.
 *  - Détection des nouveaux fichiers (création d'une session) toutes
 *    les 5 s par scan léger du `PROJECTS_DIR`.
 *
 * Volume : on filtre les sessions selon leur mtime (< 24 h) pour ne pas
 * polluer l'UI avec des sessions très anciennes.
 */
import { ipcMain } from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';
import {
  IpcChannel,
  type ClaudeSession,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { parseSessionFile } from './sessionParser';

/** Fenêtre temporelle de visibilité (h) — sessions plus vieilles sont ignorées. */
const VISIBILITY_HOURS = 24;
/**
 * Au-delà de cet âge, une session est évincée du cache (et plus seulement
 * filtrée par `getVisibleSessions`). Le double de la fenêtre de visibilité
 * laisse une marge pour ne pas retirer puis re-parser une session qui
 * vient juste de basculer hors-visible — `slowTick` re-détectera si le
 * fichier est modifié à nouveau via le scan PROJECTS_DIR.
 */
const EVICT_HOURS = VISIBILITY_HOURS * 2;
/**
 * Plafond dur du cache. Si l'utilisateur cumule beaucoup de sessions
 * dormantes, on évince les plus anciennes au-delà de cette limite. Une
 * `ClaudeSession` faisant ~1-2 KB, 200 entrées plafonnent le heap à
 * ~400 KB pour ce module.
 */
const MAX_CACHE_ENTRIES = 200;

/**
 * Tick rapide : détecte les changements mtime/size sur les fichiers
 * connus du cache. 500 ms suffit pour attraper une fenêtre
 * AskUserQuestion (Claude écrit l'event, attend la réponse).
 */
const FAST_TICK_MS = 500;

/**
 * Tick lent : recalcule les statuts (mtime-based passage working → idle)
 * ET scanne le `PROJECTS_DIR` pour détecter les nouveaux fichiers
 * (nouvelles sessions Claude créées après le boot).
 */
const SLOW_TICK_MS = 5_000;

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

let fastTimer: NodeJS.Timeout | null = null;
let slowTimer: NodeJS.Timeout | null = null;
/** Cache des sessions indexé par path absolu de fichier. */
const cache = new Map<string, ClaudeSession>();
/**
 * Snapshot mtime/size par path. Sert au polling rapide pour ne re-parser
 * que les fichiers réellement modifiés.
 */
const fileStats = new Map<string, { mtimeMs: number; size: number }>();

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.ClaudeChange, getVisibleSessions());
}

/**
 * Trie les sessions par activité décroissante et filtre celles trop
 * anciennes (cf. VISIBILITY_HOURS).
 */
function getVisibleSessions(): ClaudeSession[] {
  const cutoff = Date.now() - VISIBILITY_HOURS * 3600 * 1000;
  const list = [...cache.values()].filter((s) => {
    const t = Date.parse(s.lastActivity);
    return Number.isFinite(t) && t > cutoff;
  });
  list.sort(
    (a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity),
  );
  return list;
}

/**
 * Tick rapide : stat chaque fichier connu, détecte ceux dont mtime ou
 * size a changé, et les re-parse. Très cheap (juste des stat() Windows).
 */
async function fastTick(): Promise<void> {
  for (const [path, prevStat] of fileStats) {
    let stat;
    try {
      stat = await fs.stat(path);
    } catch {
      // Fichier supprimé.
      cache.delete(path);
      fileStats.delete(path);
      broadcast();
      continue;
    }
    if (
      stat.mtimeMs !== prevStat.mtimeMs ||
      stat.size !== prevStat.size
    ) {
      fileStats.set(path, { mtimeMs: stat.mtimeMs, size: stat.size });
      const parsed = await parseSessionFile(path);
      if (!parsed) {
        cache.delete(path);
        fileStats.delete(path);
      } else {
        cache.set(path, parsed);
      }
      broadcast();
    }
  }
}

/**
 * Tick lent : recalcule les statuts (transition working → idle dépend
 * du temps écoulé) ET scanne le PROJECTS_DIR pour détecter les nouvelles
 * sessions créées après le boot.
 */
async function slowTick(): Promise<void> {
  let changed = false;

  // 1. Recalcule des statuts pour les fichiers connus (le statut
  //    dépend de la mtime → working → waiting → idle → done même sans
  //    modification du fichier).
  for (const path of cache.keys()) {
    const before = cache.get(path)?.status;
    const fresh = await parseSessionFile(path);
    if (fresh) {
      cache.set(path, fresh);
      if (fresh.status !== before) {
        changed = true;
      }
    } else {
      cache.delete(path);
      fileStats.delete(path);
      changed = true;
    }
  }

  // 2. Détection de nouveaux fichiers (nouvelles sessions).
  try {
    const projectDirs = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const dirent of projectDirs) {
      if (!dirent.isDirectory()) continue;
      const dirPath = join(PROJECTS_DIR, dirent.name);
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        const filePath = join(dirPath, f.name);
        if (!cache.has(filePath)) {
          const session = await parseSessionFile(filePath);
          if (session) {
            cache.set(filePath, session);
            try {
              const stat = await fs.stat(filePath);
              fileStats.set(filePath, {
                mtimeMs: stat.mtimeMs,
                size: stat.size,
              });
            } catch {
              /* ignore */
            }
            changed = true;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[claude] scan PROJECTS_DIR échoué:', err);
  }

  // Éviction par âge : retire du cache les sessions dont `lastActivity` est
  // plus vieille que `EVICT_HOURS`. Bornage doux qui suit le rythme du
  // tick lent (5 s). Une session re-modifiée plus tard sera ré-ingérée par
  // le scan PROJECTS_DIR.
  const evictCutoff = Date.now() - EVICT_HOURS * 3600 * 1000;
  for (const [path, session] of cache) {
    const t = Date.parse(session.lastActivity);
    if (!Number.isFinite(t) || t < evictCutoff) {
      cache.delete(path);
      fileStats.delete(path);
      changed = true;
    }
  }

  // Bornage dur (cas extrême : > 200 sessions actives en cumulé). On
  // évince les plus anciennes par `lastActivity` jusqu'à retomber sous
  // le plafond.
  if (cache.size > MAX_CACHE_ENTRIES) {
    const sorted = [...cache.entries()].sort(
      (a, b) =>
        Date.parse(a[1].lastActivity) - Date.parse(b[1].lastActivity),
    );
    const excess = cache.size - MAX_CACHE_ENTRIES;
    for (let i = 0; i < excess; i++) {
      const [path] = sorted[i];
      cache.delete(path);
      fileStats.delete(path);
    }
    changed = true;
  }

  if (changed) broadcast();
}

/** Scan initial : énumère tous les .jsonl actuellement présents. */
async function initialScan(): Promise<void> {
  try {
    const projectDirs = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const dirent of projectDirs) {
      if (!dirent.isDirectory()) continue;
      const dirPath = join(PROJECTS_DIR, dirent.name);
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        const filePath = join(dirPath, f.name);
        const session = await parseSessionFile(filePath);
        if (session) {
          cache.set(filePath, session);
          try {
            const stat = await fs.stat(filePath);
            fileStats.set(filePath, {
              mtimeMs: stat.mtimeMs,
              size: stat.size,
            });
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch (err) {
    console.warn('[claude] scan initial échoué:', err);
  }
  broadcast();
}

/**
 * Démarre le scan initial + les deux tickers. Idempotent.
 */
async function startWatcher(): Promise<void> {
  if (fastTimer || slowTimer) return;
  try {
    await fs.access(PROJECTS_DIR);
  } catch {
    console.warn(
      `[claude] ${PROJECTS_DIR} n'existe pas — module Claude inactif tant qu'aucune session n'aura été lancée.`,
    );
    return;
  }

  await initialScan();
  console.log(`[claude] scan initial : ${cache.size} session(s) en cache`);

  fastTimer = setInterval(() => {
    void fastTick();
  }, FAST_TICK_MS);
  slowTimer = setInterval(() => {
    void slowTick();
  }, SLOW_TICK_MS);
  console.log(
    `[claude] polling actif : fast=${FAST_TICK_MS}ms, slow=${SLOW_TICK_MS}ms`,
  );
}

export async function registerClaudeIpc(): Promise<void> {
  ipcMain.handle(IpcChannel.ClaudeList, () => getVisibleSessions());
  await startWatcher();
}

export function stopClaude(): void {
  if (fastTimer) {
    clearInterval(fastTimer);
    fastTimer = null;
  }
  if (slowTimer) {
    clearInterval(slowTimer);
    slowTimer = null;
  }
}
