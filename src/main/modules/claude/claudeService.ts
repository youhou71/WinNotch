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
import { computeStatus, parseSessionFile } from './sessionParser';

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
 * Stat un fichier connu et le re-parse si mtime/size a bougé (ou le retire
 * du cache s'il a disparu). Retourne true si le cache a changé. Aucun
 * broadcast ici — les ticks coalescent en un seul envoi.
 */
async function checkFile(path: string): Promise<boolean> {
  const prevStat = fileStats.get(path);
  let stat;
  try {
    stat = await fs.stat(path);
  } catch {
    // Fichier supprimé.
    cache.delete(path);
    fileStats.delete(path);
    return true;
  }
  if (
    prevStat &&
    stat.mtimeMs === prevStat.mtimeMs &&
    stat.size === prevStat.size
  ) {
    return false;
  }
  fileStats.set(path, { mtimeMs: stat.mtimeMs, size: stat.size });
  const parsed = await parseSessionFile(path);
  if (!parsed) {
    cache.delete(path);
    fileStats.delete(path);
  } else {
    cache.set(path, parsed);
  }
  return true;
}

/** Gardes de réentrance : un tick lent (scan dir) peut dépasser 500 ms. */
let fastTickInFlight = false;
let slowTickInFlight = false;

/**
 * Tick rapide : ne stat QUE les sessions actives (working/waiting) — ce
 * sont les seules dont le fichier peut bouger d'une demi-seconde à l'autre
 * (audit perf P4 : on stat-ait tous les fichiers du cache, sessions
 * dormantes comprises, 2×/s). Les sessions idle/done sont surveillées par
 * le tick lent (une reprise est détectée en ≤ 5 s, suffisant). Broadcast
 * unique par tick au lieu d'un envoi de la liste complète par fichier
 * modifié.
 */
async function fastTick(): Promise<void> {
  if (fastTickInFlight) return;
  fastTickInFlight = true;
  try {
    let changed = false;
    for (const [path, session] of cache) {
      if (session.status !== 'working' && session.status !== 'waiting') continue;
      if (await checkFile(path)) changed = true;
    }
    if (changed) broadcast();
  } finally {
    fastTickInFlight = false;
  }
}

/**
 * Tick lent : recalcule les statuts EN PURE MÉMOIRE (la transition
 * working → waiting → idle → done ne dépend que du mtime déjà connu et des
 * flags `endedTurn`/`waitingForInput` persistés au parse — audit perf P4 :
 * on re-parsait ici tous les .jsonl du cache toutes les 5 s, soit jusqu'à
 * 512 KB de lecture par fichier pour ne recalculer qu'un statut), surveille
 * les sessions dormantes (reprise/suppression), scanne le PROJECTS_DIR
 * pour les nouvelles sessions, et borne le cache.
 */
async function slowTick(): Promise<void> {
  if (slowTickInFlight) return;
  slowTickInFlight = true;
  try {
    await slowTickBody();
  } finally {
    slowTickInFlight = false;
  }
}

async function slowTickBody(): Promise<void> {
  let changed = false;

  // 1. Recalcul des statuts en mémoire pour les fichiers connus, zéro I/O.
  for (const [path, session] of cache) {
    const stat = fileStats.get(path);
    if (!stat) continue;
    const status = computeStatus(
      stat.mtimeMs,
      session.endedTurn,
      session.waitingForInput,
    );
    if (status !== session.status) {
      cache.set(path, { ...session, status });
      changed = true;
    }
  }

  // 1bis. Sessions dormantes (idle/done) : un stat toutes les 5 s pour
  //       détecter une reprise (l'utilisateur relance la session) ou une
  //       suppression — le tick rapide ne les regarde plus.
  for (const [path, session] of cache) {
    if (session.status === 'working' || session.status === 'waiting') continue;
    if (await checkFile(path)) changed = true;
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
